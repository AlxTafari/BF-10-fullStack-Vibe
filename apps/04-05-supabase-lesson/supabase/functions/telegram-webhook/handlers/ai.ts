import { AI_FALLBACK, MAIN_MENU_KEYBOARD, suggestionsKeyboard } from "../../_shared/content.ts";
import type { AiSettings } from "../../_shared/domain/aiSettings.ts";
import { runAgentTurn } from "../../_shared/services/ai/agent.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

/** Индикатор «печатает…» живёт ~5 с — пока агент думает, обновляем его чуть чаще. */
const TYPING_REFRESH_MS = 4_000;

/**
 * Свободный текст гостя → ход агента (S09). Обработчик LLM не вызывает (ADR-008): только показывает
 * «печатает…», зовёт services/ai и отправляет результат. Реплика гостя уже записана роутером.
 */
export async function handleAiText(ctx: HandlerContext, settings: AiSettings): Promise<void> {
  const stopTyping = startTyping(ctx);
  let turn;
  try {
    turn = await runAgentTurn({ client: ctx.client, llm: ctx.llm }, { conversation: ctx.conversation, settings });
  } finally {
    stopTyping();
  }

  if (turn.kind === "reply") {
    await reply(ctx, turn.text, suggestionsKeyboard(turn.suggestions), "text", {
      ai: true,
      model: turn.model,
      tools: turn.tools,
    });
    return;
  }
  // Агент не ответил — кнопки работают всегда: главное меню. Причина — только в meta (видно в журнале), не гостю.
  await reply(ctx, AI_FALLBACK, MAIN_MENU_KEYBOARD, "text", { aiFallback: turn.reason });
}

/**
 * «Печатает…» сразу и каждые TYPING_REFRESH_MS, пока идёт ход. Индикатор — украшение: сбой Telegram здесь
 * не должен сломать ответ, ошибки глотаем. Возвращает функцию остановки.
 */
function startTyping(ctx: HandlerContext): () => void {
  const send = () => ctx.tg.sendChatAction(ctx.chatId, "typing").catch(() => {});
  send();
  const timer = setInterval(send, TYPING_REFRESH_MS);
  return () => clearInterval(timer);
}
