import { decideNav, parseFaqAnswerId, parseLastNav, type NavScreen } from "../_shared/domain/navigation.ts";
import { recordMessage } from "../_shared/services/conversations.ts";
import { rememberFaqAnswer, rememberNav, reloadLastNav } from "../_shared/services/navigation.ts";
import { isMessageGoneError, isNotModifiedError, TelegramApiError } from "../_shared/telegram/client.ts";
import type { MessageKind } from "../_shared/types.ts";
import type { InlineKeyboard } from "../_shared/telegram/types.ts";
import type { HandlerContext } from "./context.ts";

export function logIncoming(ctx: HandlerContext, text: string, kind: MessageKind = "text"): Promise<void> {
  return recordMessage(ctx.client, ctx.conversation.id, "in", text, kind);
}

/**
 * Отправка ответа гостю + запись исходящего сообщения в диалог.
 * kind = 'search' — ответ на поиск блюда (хранится 7 дней, как сам запрос); остальное — 'text'.
 */
export async function reply(
  ctx: HandlerContext,
  text: string,
  keyboard?: InlineKeyboard,
  kind: MessageKind = "text",
): Promise<void> {
  await ctx.tg.sendMessage(ctx.chatId, text, keyboard);
  await recordMessage(ctx.client, ctx.conversation.id, "out", text, kind);
}

/** Что писать в лог про сбой побочной операции: только класс ошибки, без текста (в нём бывают данные гостя). */
function errorClass(error: unknown): string {
  return error instanceof TelegramApiError ? `telegram ${error.errorCode}` : error instanceof Error ? error.name : "unknown";
}

/** Удаление и снятие кнопок — уборка, а не ответ гостю: любая ошибка (уже удалено, старше 48 ч, нет прав) не ломает апдейт. */
async function bestEffort(what: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(`${what} failed:`, errorClass(error));
  }
}

/**
 * Ответ-навигация (S06d): меню, «Информация», «Меню блюд». Что делать с предыдущим сообщением бота, решает
 * domain/navigation.ts: править на месте (только «Меню блюд»), удалить точный дубль в окне или просто отправить.
 * В группах работает как reply(): удалять и править там бот не должен.
 * redraw — итог сценария: новое сообщение внизу вместо правки сводки выше (см. decideNav).
 */
export async function replyNav(
  ctx: HandlerContext,
  screen: NavScreen,
  text: string,
  keyboard?: InlineKeyboard,
  redraw = false,
): Promise<void> {
  if (!ctx.isPrivate) return reply(ctx, text, keyboard);

  const last = parseLastNav(ctx.conversation.last_nav);
  const decision = decideNav({ screen, callbackMessageId: ctx.callbackMessageId, last, now: new Date(), redraw });

  if (decision.type === "edit") {
    try {
      await ctx.tg.editMessageText(ctx.chatId, decision.messageId, text, keyboard);
      // screen и время обновляем, message_id тот же: «последним» остаётся это же сообщение.
      await bestEffort("set_last_nav", () =>
        rememberNav(ctx.client, {
          conversationId: ctx.conversation.id,
          expected: decision.messageId,
          screen,
          messageId: decision.messageId,
        }));
      await recordMessage(ctx.client, ctx.conversation.id, "out", text);
      return;
    } catch (error) {
      // Кнопка вела на тот же контент: успех, в журнал ничего не пишем (строки без изменения в чате не было).
      if (isNotModifiedError(error)) return;
      // Сообщения уже нет или его нельзя править — гость всё равно должен получить экран: отправляем новое.
      if (!isMessageGoneError(error)) throw error;
    }
    await sendNav(ctx, screen, text, keyboard, last?.messageId ?? null, null);
    return;
  }

  await sendNav(ctx, screen, text, keyboard, last?.messageId ?? null, decision.deleteId);
}

/** Порядок «сначала отправить, потом удалить»: при сбое в худшем случае два одинаковых сообщения, а не ни одного. */
async function sendNav(
  ctx: HandlerContext,
  screen: NavScreen,
  text: string,
  keyboard: InlineKeyboard | undefined,
  expected: number | null,
  deleteId: number | null,
): Promise<void> {
  const messageId = await ctx.tg.sendMessage(ctx.chatId, text, keyboard);

  let won: boolean | null = null;
  try {
    won = await rememberNav(ctx.client, { conversationId: ctx.conversation.id, expected, screen, messageId });
  } catch (error) {
    // Деградация, не отказ: не записали last_nav — на этот раз антидубль не сработает.
    console.error("set_last_nav failed:", errorClass(error));
  }

  if (won === true && deleteId !== null) {
    await bestEffort("deleteMessage", () => ctx.tg.deleteMessage(ctx.chatId, deleteId));
  } else if (won === false) {
    // Параллельный апдейт записался раньше. Тот же экран — двойной тап: в чате остаётся сообщение победителя,
    // свою отправку убираем. Другой экран — два разных быстрых нажатия: наше сообщение остаётся, просто не отслеживается.
    await bestEffort("duplicate cleanup", async () => {
      const winner = await reloadLastNav(ctx.client, ctx.conversation.id);
      if (winner?.screen === screen) await ctx.tg.deleteMessage(ctx.chatId, messageId);
    });
  }

  // В журнал — всегда, включая дубли: он показывает всё, что бот отправил, а шум чистит ретеншн.
  await recordMessage(ctx.client, ctx.conversation.id, "out", text);
}

/**
 * Ответ FAQ (S06d): отправляется всегда новым сообщением и не удаляется, но у ПРЕДЫДУЩЕГО ответа бот снимает
 * клавиатуру — кнопки «К вопросам»/«Главное меню» остаются только у последнего. Текст прежних ответов не трогается.
 */
export async function replyFaqAnswer(ctx: HandlerContext, text: string, keyboard: InlineKeyboard): Promise<void> {
  if (!ctx.isPrivate) return reply(ctx, text, keyboard);

  const messageId = await ctx.tg.sendMessage(ctx.chatId, text, keyboard);
  await recordMessage(ctx.client, ctx.conversation.id, "out", text);

  // Дальше — уборка: при любом сбое у старого ответа просто останутся кнопки.
  let previous: number[] = [];
  try {
    previous = await rememberFaqAnswer(ctx.client, {
      conversationId: ctx.conversation.id,
      expected: parseFaqAnswerId(ctx.conversation.last_nav),
      messageId,
    });
  } catch (error) {
    console.error("set_faq_answer failed:", errorClass(error));
  }
  for (const id of previous) {
    await bestEffort("clearKeyboard", () => ctx.tg.clearKeyboard(ctx.chatId, id));
  }
}

/**
 * Служебное сообщение, которое само исчезает через `ttlSeconds` (предупреждение антиспама). В журнал не пишется.
 * Таймеров в Edge Function нет, поэтому пауза живёт в фоновой задаче EdgeRuntime.waitUntil: воркер остаётся живым,
 * пока она не завершится (лимит жизни воркера 150–400 с, пауза в него укладывается). Если воркер всё же убьют раньше
 * (деплой, сбой), сообщение просто останется в чате — деградация, не отказ.
 */
export async function sendTemporary(ctx: HandlerContext, text: string, ttlSeconds: number): Promise<void> {
  const messageId = await ctx.tg.sendMessage(ctx.chatId, text);
  const cleanup = (async () => {
    await new Promise((resolve) => setTimeout(resolve, ttlSeconds * 1000));
    await bestEffort("deleteMessage", () => ctx.tg.deleteMessage(ctx.chatId, messageId));
  })();
  // Вне Supabase (локальные тесты) EdgeRuntime нет — задача просто идёт сама по себе.
  (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(cleanup);
}
