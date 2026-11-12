import { AI_FALLBACK, MAIN_MENU_KEYBOARD, renderFlowReply, suggestionsKeyboard } from "../../_shared/content.ts";
import type { AiSettings } from "../../_shared/domain/aiSettings.ts";
import type { AdvanceResult, FlowReply } from "../../_shared/domain/flowState.ts";
import { type AgentTurnResult, runAgentTurn } from "../../_shared/services/ai/agent.ts";
import type { MessageMeta } from "../../_shared/types.ts";
import { guestOf, type HandlerContext } from "../context.ts";
import { reply, replyNav } from "../logging.ts";

/** Индикатор «печатает…» живёт ~5 с — пока агент думает, обновляем его чуть чаще. */
const TYPING_REFRESH_MS = 4_000;

/**
 * Свободный текст гостя вне сценария → ход агента (S09). Обработчик LLM не вызывает (ADR-008): только показывает
 * «печатает…», зовёт services/ai и отправляет результат. Реплика гостя уже записана роутером.
 */
export async function handleAiText(ctx: HandlerContext, settings: AiSettings): Promise<void> {
  const turn = await runTurn(ctx, settings);
  if (turn.kind === "reply") {
    await sendAgentReply(ctx, turn, null);
    return;
  }
  // Агент успел заполнить черновик и сломался: экран шага полезнее главного меню (там кнопки и вопрос шага).
  if (turn.draft) {
    await showStep(ctx, turn.draft.state.draftId, turn.draft.reply, fallbackMeta(turn));
    return;
  }
  // Агент не ответил — кнопки работают всегда: главное меню. Причина и расход — только в meta (журнал), не гостю.
  await reply(ctx, AI_FALLBACK, MAIN_MENU_KEYBOARD, "text", fallbackMeta(turn));
}

/**
 * Текст на шаге сценария не прошёл проверку шага (S09 §4.7): агент с контекстом шага достаёт значения
 * (draftBooking / draftGuestRequest), либо отвечает на побочный вопрос и повторяет вопрос шага. stepResult — итог
 * обычной проверки (тот же шаг с ошибкой); он же показывается, если агент не ответил — как до S09.
 */
export async function handleAiOnStep(ctx: HandlerContext, settings: AiSettings, stepResult: AdvanceResult): Promise<void> {
  const turn = await runTurn(ctx, settings);
  if (turn.kind === "reply") {
    await sendAgentReply(ctx, turn, stepResult);
    return;
  }
  const shown = turn.draft ?? stepResult;
  await showStep(ctx, shown.state.draftId, shown.reply, fallbackMeta(turn));
}

async function runTurn(ctx: HandlerContext, settings: AiSettings): Promise<AgentTurnResult> {
  const stopTyping = startTyping(ctx);
  try {
    return await runAgentTurn(
      { client: ctx.client, llm: ctx.llm },
      { conversation: ctx.conversation, settings, guest: guestOf(ctx) },
    );
  } finally {
    stopTyping();
  }
}

/**
 * Ответ агента. Есть черновик (агент его изменил или гость посреди сценария) — под текстом кнопки текущего шага,
 * а не suggestions: гость продолжает тот же сценарий. Черновик готов — текст агента, затем карточка-сводка
 * с «Отправить»: сводку собирает код, гость подтверждает проверенные данные, а не пересказ модели.
 */
async function sendAgentReply(
  ctx: HandlerContext,
  turn: Extract<AgentTurnResult, { kind: "reply" }>,
  current: AdvanceResult | null,
): Promise<void> {
  const meta: MessageMeta = { ai: true, model: turn.model, tools: turn.tools, ...turn.usage };
  const flow = turn.draft ?? current;
  if (!flow) {
    await reply(ctx, turn.text, suggestionsKeyboard(turn.suggestions), "text", meta);
    return;
  }
  const draftId = flow.state.draftId;
  // Ошибку прежней проверки шага не показываем: на текст гостя ответил агент.
  const step: FlowReply = { screen: flow.reply.screen };
  if (step.screen.screen === "confirm") {
    await reply(ctx, turn.text, undefined, "text", meta);
    await showStep(ctx, draftId, step);
    return;
  }
  const { keyboard } = renderFlowReply(draftId, step);
  await replyNav(ctx, `flow:${draftId}`, turn.text, keyboard, false, meta);
}

/** Экран шага сценария — так же, как его рисует кнопочный сценарий (handlers/flow.ts → showFlowScreen). */
async function showStep(ctx: HandlerContext, draftId: string, flowReply: FlowReply, meta?: MessageMeta): Promise<void> {
  const { text, keyboard } = renderFlowReply(draftId, flowReply);
  await replyNav(ctx, `flow:${draftId}`, text, keyboard, false, meta);
}

function fallbackMeta(turn: Extract<AgentTurnResult, { kind: "fallback" }>): MessageMeta {
  return { aiFallback: turn.reason, model: turn.model, ...turn.usage };
}

/**
 * «Печатает…» сразу и каждые TYPING_REFRESH_MS, пока идёт ход. Индикатор — украшение: сбой Telegram здесь
 * не должен сломать ответ, ошибки глотаем. Возвращает функцию остановки. Нужен и распознаванию голоса (handlers/voice.ts).
 */
export function startTyping(ctx: HandlerContext): () => void {
  const send = () => ctx.tg.sendChatAction(ctx.chatId, "typing").catch(() => {});
  send();
  const timer = setInterval(send, TYPING_REFRESH_MS);
  return () => clearInterval(timer);
}
