import type { InlineKeyboard } from "./types.ts";

/** Ответ Telegram с ok = false. Несёт код и описание, чтобы отличать «не изменилось» от поломки. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number,
    readonly description: string,
  ) {
    super(`Telegram ${method} failed: ${errorCode} ${description}`);
    this.name = "TelegramApiError";
  }
}

/** editMessageText/editMessageReplyMarkup: новое содержимое совпадает с текущим — для бота это успех. */
export function isNotModifiedError(error: unknown): boolean {
  return error instanceof TelegramApiError && error.errorCode === 400 &&
    error.description.includes("message is not modified");
}

/** Сообщения уже нет или его нельзя править (удалено гостем, чужое, слишком старое) — править нечего. */
export function isMessageGoneError(error: unknown): boolean {
  return error instanceof TelegramApiError && error.errorCode === 400 &&
    /message to edit not found|message can't be edited|message_id_invalid/i.test(error.description);
}

export function createTelegramClient(botToken: string) {
  const apiBase = `https://api.telegram.org/bot${botToken}`;

  async function call<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${apiBase}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Тело ответа Telegram — {ok:false, error_code, description}; если оно не JSON (прокси, 5xx) — код берём из HTTP.
      const body = await res.json().catch(() => null) as { error_code?: number; description?: string } | null;
      throw new TelegramApiError(method, body?.error_code ?? res.status, body?.description ?? "unknown");
    }
    const body = await res.json() as { result: T };
    return body.result;
  }

  return {
    /** Возвращает message_id отправленного сообщения. */
    async sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<number> {
      const sent = await call<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      });
      return sent.message_id;
    },
    async editMessageText(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
      await call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      });
    },
    /** Пустая клавиатура убирает кнопки; текст сообщения не меняется. */
    async clearKeyboard(chatId: number, messageId: number): Promise<void> {
      await call("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
    },
    async deleteMessage(chatId: number, messageId: number): Promise<void> {
      await call("deleteMessage", { chat_id: chatId, message_id: messageId });
    },
    async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
      await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
    },
  };
}

export type TelegramClient = ReturnType<typeof createTelegramClient>;
