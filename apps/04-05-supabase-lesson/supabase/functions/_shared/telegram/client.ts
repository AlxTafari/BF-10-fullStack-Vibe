import type { InlineKeyboard } from "./types.ts";

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
    sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
      return call("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      });
    },
    answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
      return call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
    },
  };
}

export type TelegramClient = ReturnType<typeof createTelegramClient>;
