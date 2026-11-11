// Агент (S09): один ход = контекст → LLM → tools → … → ответ. Про Telegram не знает: что отправить гостю,
// решает обработчик handlers/ai.ts по результату хода. LLM приходит параметром — в тестах фейковый.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiSettings } from "../../domain/aiSettings.ts";
import { buildHistory, buildSystemPrompt, clampReply } from "../../domain/aiPrompt.ts";
import { parseSuggestions, type Suggestion } from "../../domain/aiSuggestions.ts";
import { localDayBoundsUtc } from "../../domain/zonedTime.ts";
import { type LlmClient, LlmError, type LlmMessage } from "../../llm/types.ts";
import { countAiReplies, listRecentMessages } from "../../repositories/messagesRepo.ts";
import { getRestaurantById } from "../../repositories/restaurantsRepo.ts";
import type { AiTurnUsage, ConversationRow, MessageKind } from "../../types.ts";
import { getDishDetails } from "../menu.ts";
import { REPLY, runTool, TOOL_SCHEMAS } from "./tools.ts";

// Обработчику нужен тип клиента для зависимостей, но импортировать llm/ ему нельзя (check:layers).
export type { LlmClient };

/**
 * Сколько раундов tools с данными за ход. После них модели разрешён только reply: ход заканчивается ответом
 * по тому, что уже найдено, а не запасным ответом.
 */
export const MAX_TOOL_ROUNDS = 5;
/** Предел одного вызова LLM и всего хода (S09 §2). */
export const LLM_CALL_TIMEOUT_MS = 20_000;
export const TURN_TIMEOUT_MS = 45_000;
/** Меньше секунды на вызов не начинаем: всё равно не успеет. */
const MIN_CALL_MS = 1_000;
/** Окно истории — диалог по существу. Строки «[кнопка] …» для модели шум и только тратят окно. */
export const HISTORY_KINDS: MessageKind[] = ["text", "search"];

export type FallbackReason = "error" | "timeout" | "quota" | "limit";

/** Кнопка под ответом после проверки: у блюда есть название для подписи (подпись собирает content.ts). */
export type AgentSuggestion =
  | Exclude<Suggestion, { kind: "dish" }>
  | { kind: "dish"; dishId: string; name: string };

/**
 * Итог хода. usage — расход за ход; у fallback его нет, если до модели не дошли (лимит, нет ключа)
 * или она не ответила ни разу.
 */
export type AgentTurnResult =
  | { kind: "reply"; text: string; suggestions: AgentSuggestion[]; model: string; tools: string[]; usage: AiTurnUsage }
  | { kind: "fallback"; reason: FallbackReason; model?: string; usage?: AiTurnUsage };

export interface AgentDeps {
  client: SupabaseClient;
  /** null — ключ или модель Gemini не заданы: каждый ход сразу уходит в запасной ответ. */
  llm: LlmClient | null;
  now?: Date;
}

/**
 * Ход агента по последней реплике гостя. Реплика к этому моменту уже записана в messages (её пишет роутер),
 * поэтому она приходит последней строкой окна истории, отдельно её не передаём.
 * Не бросает: любой сбой — fallback с причиной, гость получит кнопки (инвариант «кнопки работают всегда»).
 */
export async function runAgentTurn(
  deps: AgentDeps,
  input: { conversation: ConversationRow; settings: AiSettings },
): Promise<AgentTurnResult> {
  const now = deps.now ?? new Date();
  const startedAt = Date.now();
  // Расход копится по каждому ответу модели; ms ставится в конце хода (finish).
  const usage: AiTurnUsage = { calls: 0, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, ms: 0 };
  const finish = () => ({ ...usage, ms: Date.now() - startedAt });
  // Запасной ответ несёт расход, только если модель успела ответить: эти токены оплачены.
  const fallback = (reason: FallbackReason): AgentTurnResult =>
    usage.calls > 0 && deps.llm ? { kind: "fallback", reason, model: deps.llm.model, usage: finish() } : { kind: "fallback", reason };
  try {
    if (!deps.llm) return { kind: "fallback", reason: "error" };
    const llm = deps.llm;
    const { conversation, settings } = input;

    const restaurant = await getRestaurantById(deps.client, conversation.restaurant_id);
    if (!restaurant) return { kind: "fallback", reason: "error" };

    // Лимит — до вызова модели: исчерпан — ни одного токена не тратим.
    const day = localDayBoundsUtc(now, restaurant.timezone);
    const used = await countAiReplies(deps.client, conversation.id, day.from, day.to);
    if (used >= settings.dailyTurnLimit) return { kind: "fallback", reason: "limit" };

    const rows = await listRecentMessages(deps.client, conversation.id, HISTORY_KINDS, settings.historyWindow);
    const history = buildHistory(rows);
    // Последней должна быть реплика гостя — на неё и отвечаем. Иначе отвечать не на что.
    if (history.length === 0 || history[history.length - 1].role !== "guest") return { kind: "fallback", reason: "error" };

    const messages: LlmMessage[] = history.map((t) =>
      t.role === "guest" ? { role: "user", text: t.text } : { role: "model", text: t.text }
    );
    const system = buildSystemPrompt({ restaurantName: restaurant.name, timeZone: restaurant.timezone, now });
    const toolCtx = { client: deps.client, conversationId: conversation.id, now };
    // Какие tools с данными агент вызвал за ход (для журнала); reply — сам ответ, в список не идёт.
    const toolsUsed: string[] = [];
    const done = async (text: string, suggestions: Suggestion[]): Promise<AgentTurnResult> => ({
      kind: "reply",
      text: clampReply(text),
      suggestions: await onlyPublishedDishes(deps.client, suggestions),
      model: llm.model,
      tools: toolsUsed,
      usage: finish(),
    });

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const left = TURN_TIMEOUT_MS - (Date.now() - startedAt);
      if (left < MIN_CALL_MS) return fallback("timeout");

      const response = await llm.generate({
        system,
        messages,
        tools: TOOL_SCHEMAS,
        // Ответ — только вызовом tool: финальный текст приходит через reply вместе с кнопками.
        requireToolCall: true,
        // Раунды с данными кончились — остаётся только ответить по найденному.
        allowedTools: round === MAX_TOOL_ROUNDS ? [REPLY] : undefined,
        timeoutMs: Math.min(LLM_CALL_TIMEOUT_MS, left),
      });
      usage.calls++;
      usage.inputTokens += response.usage?.input ?? 0;
      usage.outputTokens += response.usage?.output ?? 0;
      usage.thoughtTokens += response.usage?.thoughts ?? 0;

      // Простой текст при requireToolCall провайдер давать не должен; если всё же дал — это ответ без кнопок.
      if (response.kind === "text") return await done(response.text, []);

      // Один reply с текстом — конец хода. reply с пустым текстом идёт дальше как обычный раунд: модель получит
      // ошибку empty_text и ответит снова, а гость не получит пустое сообщение.
      const replyCall = response.calls.length === 1 && response.calls[0].name === REPLY ? response.calls[0] : null;
      const replyText = typeof replyCall?.args?.text === "string" ? replyCall.args.text.trim() : "";
      if (replyCall && replyText) return await done(replyText, parseSuggestions(replyCall.args?.actions));

      // Модель просит данные: её сообщение (с providerState) и результаты уходят в контекст следующего вызова.
      // reply рядом с другими tools — ответ до результатов: отклоняется (runTool вернёт reply_ignored), чтобы
      // текст не был написан вслепую. На каждый вызов нужен ответ — так требует провайдер.
      messages.push({ role: "model", text: response.text, toolCalls: response.calls, providerState: response.providerState });
      const results = await Promise.all(response.calls.map(async (call) => {
        if (call.name === REPLY) {
          const result = replyCall ? { error: "empty_text", details: "reply.text must not be empty" } : await runTool(toolCtx, call);
          return { callId: call.id, name: call.name, result };
        }
        toolsUsed.push(call.name);
        return { callId: call.id, name: call.name, result: await runTool(toolCtx, call) };
      }));
      messages.push({ role: "tool", results });
    }
    // Даже на последнем раунде (разрешён только reply) ответа нет.
    console.error("agent: no reply after tool rounds");
    return fallback("error");
  } catch (error) {
    if (error instanceof LlmError) {
      // Текст LlmError без данных гостя (см. llm/types.ts): для quota в нём имя исчерпанного лимита.
      console.error(`agent llm error: ${error.kind} — ${error.message}`);
      if (error.kind === "quota" || error.kind === "timeout") return fallback(error.kind);
      return fallback("error");
    }
    console.error("agent failed:", error instanceof Error ? error.name : "unknown");
    return fallback("error");
  }
}

/** Кнопка «Карточка блюда» — только на существующее, опубликованное и доступное блюдо (§4.17). */
async function onlyPublishedDishes(client: SupabaseClient, suggestions: Suggestion[]): Promise<AgentSuggestion[]> {
  const checked = await Promise.all(suggestions.map(async (s): Promise<AgentSuggestion | null> => {
    if (s.kind !== "dish") return s;
    const dish = await getDishDetails(client, { dishId: s.dishId });
    return dish?.card.is_available ? { kind: "dish", dishId: s.dishId, name: dish.card.name } : null;
  }));
  return checked.filter((s): s is AgentSuggestion => s !== null);
}
