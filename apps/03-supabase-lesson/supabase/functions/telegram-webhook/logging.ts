import type { InlineKeyboard, ReplyKeyboard } from "../_shared/telegram/types.ts";
import { logMessage } from "../_shared/repositories/messagesRepo.ts";
import { touchLastMessageAt } from "../_shared/repositories/usersRepo.ts";
import type { HandlerContext } from "./context.ts";

export async function logIncoming(ctx: HandlerContext, userId: string, text: string): Promise<void> {
  await logMessage(ctx.client, { userId, direction: "in", text });
  await touchLastMessageAt(ctx.client, userId);
}

/** Отправка ответа юзеру + лог исходящего сообщения + last_message_at. */
export async function reply(
  ctx: HandlerContext,
  userId: string,
  text: string,
  keyboard?: InlineKeyboard,
  replyKeyboard?: ReplyKeyboard,
): Promise<void> {
  await ctx.tg.sendMessage(ctx.chatId, text, keyboard, replyKeyboard);
  await logMessage(ctx.client, { userId, direction: "out", text });
  await touchLastMessageAt(ctx.client, userId);
}
