import type { InlineKeyboard, InlineQueryResultArticle, ReplyKeyboard } from "./types.ts";

export function createTelegramClient(botToken: string) {
  const apiBase = `https://api.telegram.org/bot${botToken}`;

  async function call(method: string, payload: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${apiBase}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram ${method} failed: ${res.status} ${body}`);
    }
  }

  return {
    // keyboard и replyKeyboard взаимоисключающие — тг разрешает только один reply_markup на сообщение.
    sendMessage(
      chatId: number,
      text: string,
      keyboard?: InlineKeyboard,
      replyKeyboard?: ReplyKeyboard,
    ): Promise<void> {
      const replyMarkup = keyboard
        ? { inline_keyboard: keyboard }
        : replyKeyboard
          ? { keyboard: replyKeyboard, resize_keyboard: true }
          : undefined;
      return call("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });
    },
    editMessageText(
      chatId: number,
      messageId: number,
      text: string,
      keyboard?: InlineKeyboard,
    ): Promise<void> {
      return call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      });
    },
    answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
      return call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
    },
    answerInlineQuery(inlineQueryId: string, results: InlineQueryResultArticle[]): Promise<void> {
      return call("answerInlineQuery", { inline_query_id: inlineQueryId, results, cache_time: 0 });
    },
  };
}

export type TelegramClient = ReturnType<typeof createTelegramClient>;
