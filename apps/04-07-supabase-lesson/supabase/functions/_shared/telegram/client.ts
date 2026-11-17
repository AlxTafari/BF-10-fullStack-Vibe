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
  // Файлы скачиваются с отдельного адреса. В нём токен бота: URL не уходит ни в лог, ни в ошибку, ни наружу.
  const fileBase = `https://api.telegram.org/file/bot${botToken}`;

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
    /** «Печатает…» в шапке чата: держится ~5 с или до следующего сообщения бота. */
    async sendChatAction(chatId: number, action: "typing"): Promise<void> {
      await call("sendChatAction", { chat_id: chatId, action });
    },
    async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
      await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
    },
    /**
     * Скачать файл по file_id (S09: голосовые): getFile даёт путь, ссылка по нему живёт около часа, поэтому
     * качаем сразу. Сам file_id бот может использовать и позже. maxBytes — защита от неожиданно большого файла:
     * Telegram прислал размер больше — не качаем.
     */
    async downloadFile(fileId: string, maxBytes: number): Promise<{ bytes: Uint8Array; size: number }> {
      const file = await call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
      if (!file.file_path) throw new TelegramApiError("getFile", 400, "no file_path");
      if (file.file_size !== undefined && file.file_size > maxBytes) throw new TelegramApiError("getFile", 413, "file too big");
      const res = await fetch(`${fileBase}/${file.file_path}`);
      // В ошибке — только HTTP-код: URL с токеном не пишем.
      if (!res.ok) throw new TelegramApiError("downloadFile", res.status, "download failed");
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new TelegramApiError("downloadFile", 413, "file too big");
      return { bytes, size: bytes.byteLength };
    },
  };
}

export type TelegramClient = ReturnType<typeof createTelegramClient>;
