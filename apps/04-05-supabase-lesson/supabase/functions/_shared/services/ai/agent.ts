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
import type { ConversationRow, MessageKind } from "../../types.ts";
import { getDishDetails } from "../menu.ts";
import { runTool, SUGGEST_ACTIONS, TOOL_SCHEMAS } from "./tools.ts";

// Обработчику нужен тип клиента для зависимостей, но импортировать llm/ ему нельзя (check:layers).
export type { LlmClient };

/** Сколько раз за ход модель может попросить tools. Дальше — запасной ответ: модель, видимо, зациклилась. */
export const MAX_TOOL_ROUNDS = 5;
/** Предел одного вызова LLM и всего хода (S09 §2). */
export const LLM_CALL_TIMEOUT_MS = 20_000;
export const TURN_TIMEOUT_MS = 45_000;
/** Меньше секунды на вызов не начинаем: всё равно не успеет. */
const MIN_CALL_MS = 1_000;
/** Окно истории — диалог по существу. Строки «[кнопка] …» для модели шум и только тратят окно. */
export const HISTORY_KINDS: MessageKind[] = ["text", "search"];

export type FallbackReason = "error" | "timeout" | "quota" | "limit";

export type AgentTurnResult =
  | { kind: "reply"; text: string; suggestions: Suggestion[]; model: string; tools: string[] }
  | { kind: "fallback"; reason: FallbackReason };

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
    const toolsUsed: string[] = [];
    let suggestions: Suggestion[] = [];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const left = TURN_TIMEOUT_MS - (Date.now() - startedAt);
      if (left < MIN_CALL_MS) return { kind: "fallback", reason: "timeout" };

      const response = await llm.generate({
        system,
        messages,
        tools: TOOL_SCHEMAS,
        timeoutMs: Math.min(LLM_CALL_TIMEOUT_MS, left),
      });

      if (response.kind === "text") {
        return {
          kind: "reply",
          text: clampReply(response.text),
          suggestions: await onlyPublishedDishes(deps.client, suggestions),
          model: llm.model,
          tools: toolsUsed,
        };
      }

      // Модель просит tools: её сообщение (с providerState) и результаты уходят в контекст следующего вызова.
      messages.push({ role: "model", text: response.text, toolCalls: response.calls, providerState: response.providerState });
      const results = await Promise.all(response.calls.map(async (call) => {
        toolsUsed.push(call.name);
        if (call.name === SUGGEST_ACTIONS) suggestions = parseSuggestions(call.args?.actions);
        return { callId: call.id, name: call.name, result: await runTool(toolCtx, call) };
      }));
      messages.push({ role: "tool", results });
    }
    // MAX_TOOL_ROUNDS раундов tools, а ответа всё нет.
    console.error("agent: tool rounds exceeded");
    return { kind: "fallback", reason: "error" };
  } catch (error) {
    if (error instanceof LlmError) {
      console.error("agent llm error:", error.kind);
      if (error.kind === "quota" || error.kind === "timeout") return { kind: "fallback", reason: error.kind };
      return { kind: "fallback", reason: "error" };
    }
    console.error("agent failed:", error instanceof Error ? error.name : "unknown");
    return { kind: "fallback", reason: "error" };
  }
}

/** Кнопка «Карточка блюда» — только на существующее, опубликованное и доступное блюдо (§4.17). */
async function onlyPublishedDishes(client: SupabaseClient, suggestions: Suggestion[]): Promise<Suggestion[]> {
  const checked = await Promise.all(suggestions.map(async (s) => {
    if (s.kind !== "dish") return s;
    const dish = await getDishDetails(client, { dishId: s.dishId });
    return dish?.card.is_available ? s : null;
  }));
  return checked.filter((s): s is Suggestion => s !== null);
}
