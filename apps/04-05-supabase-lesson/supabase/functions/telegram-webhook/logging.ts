import { recordMessage } from "../_shared/services/conversations.ts";
import type { MessageKind } from "../_shared/types.ts";
import type { InlineKeyboard } from "../_shared/telegram/types.ts";
import type { HandlerContext } from "./context.ts";

export function logIncoming(ctx: HandlerContext, text: string, kind: MessageKind = "text"): Promise<void> {
  return recordMessage(ctx.client, ctx.conversation.id, "in", text, kind);
}

/** Отправка ответа гостю + запись исходящего сообщения в диалог. */
export async function reply(ctx: HandlerContext, text: string, keyboard?: InlineKeyboard): Promise<void> {
  await ctx.tg.sendMessage(ctx.chatId, text, keyboard);
  await recordMessage(ctx.client, ctx.conversation.id, "out", text);
}
