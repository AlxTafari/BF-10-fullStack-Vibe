// Подменный Telegram-клиент для сценарных тестов (S07). Боевой код не знает о нём: роутер получает клиента
// параметром deps.tg (ADR-008). В настоящий Telegram ничего не уходит.

// Методы подмены объявлены async без await намеренно: так ошибка из throw становится отклонённым Promise,
// как у настоящего клиента. Без async она вылетала бы синхронно, и подмена вела бы себя иначе, чем боевой код.
// deno-lint-ignore-file require-await
import { type TelegramClient, TelegramApiError } from "../../_shared/telegram/client.ts";
import type { InlineKeyboard } from "../../_shared/telegram/types.ts";

export type FakeMethod = keyof TelegramClient;

/** Один вызов клиента — то, что бот попытался сделать. */
export interface FakeCall {
  method: FakeMethod;
  chatId: number | null; // answerCallbackQuery без чата
  messageId: number | null;
  text: string | null;
  keyboard: InlineKeyboard | null;
}

/** Сообщение в чате в его текущем виде: после правок, без удалённых. Это то, что видит гость. */
export interface FakeMessage {
  messageId: number;
  text: string;
  keyboard: InlineKeyboard;
}

export interface FakeTelegram extends TelegramClient {
  readonly calls: FakeCall[];
  /** Видимые сообщения чата сверху вниз. */
  messages(chatId: number): FakeMessage[];
  /** Самое нижнее сообщение чата — текущий экран гостя. */
  last(chatId: number): FakeMessage;
  /** Следующий вызов `method` (для `chatId`, если задан) бросит `error` — как Telegram при блокировке бота и т.п. */
  failNext(method: FakeMethod, error: TelegramApiError, chatId?: number): void;
}

/** Ошибка в формате настоящего клиента: роутер различает их по коду и описанию (isMessageGoneError и др.). */
export function telegramError(method: string, code: number, description: string): TelegramApiError {
  return new TelegramApiError(method, code, description);
}

export function createFakeTelegram(): FakeTelegram {
  const calls: FakeCall[] = [];
  const chats = new Map<number, Map<number, FakeMessage>>();
  const failures: { method: FakeMethod; chatId?: number; error: TelegramApiError }[] = [];
  // message_id в Telegram растёт в пределах чата; одного счётчика на всех тестам достаточно.
  let nextMessageId = 1;

  function chat(chatId: number): Map<number, FakeMessage> {
    let messages = chats.get(chatId);
    if (!messages) chats.set(chatId, messages = new Map());
    return messages;
  }

  /** Записывает вызов и, если сценарий так задумал, бросает ошибку вместо выполнения. */
  function record(call: FakeCall): void {
    calls.push(call);
    const i = failures.findIndex((f) => f.method === call.method && (f.chatId === undefined || f.chatId === call.chatId));
    if (i >= 0) throw failures.splice(i, 1)[0].error;
  }

  // Правка и удаление несуществующего сообщения — та же ошибка, что у Telegram: роутер на неё полагается (fallback).
  function existing(chatId: number, messageId: number, method: string): FakeMessage {
    const message = chat(chatId).get(messageId);
    if (!message) throw telegramError(method, 400, "Bad Request: message to edit not found");
    return message;
  }

  return {
    calls,
    messages: (chatId) => [...chat(chatId).values()],
    last(chatId) {
      const all = [...chat(chatId).values()];
      if (all.length === 0) throw new Error(`в чате ${chatId} нет сообщений`);
      return all[all.length - 1];
    },
    failNext(method, error, chatId) {
      failures.push({ method, chatId, error });
    },

    async sendMessage(chatId, text, keyboard) {
      record({ method: "sendMessage", chatId, messageId: null, text, keyboard: keyboard ?? null });
      const messageId = nextMessageId++;
      chat(chatId).set(messageId, { messageId, text, keyboard: keyboard ?? [] });
      return messageId;
    },
    async editMessageText(chatId, messageId, text, keyboard) {
      record({ method: "editMessageText", chatId, messageId, text, keyboard: keyboard ?? null });
      const message = existing(chatId, messageId, "editMessageText");
      // Telegram отвечает ошибкой на правку без изменений; бот считает её успехом (isNotModifiedError).
      if (message.text === text && JSON.stringify(message.keyboard) === JSON.stringify(keyboard ?? [])) {
        throw telegramError("editMessageText", 400, "Bad Request: message is not modified");
      }
      message.text = text;
      message.keyboard = keyboard ?? [];
    },
    async clearKeyboard(chatId, messageId) {
      record({ method: "clearKeyboard", chatId, messageId, text: null, keyboard: null });
      existing(chatId, messageId, "editMessageReplyMarkup").keyboard = [];
    },
    async deleteMessage(chatId, messageId) {
      record({ method: "deleteMessage", chatId, messageId, text: null, keyboard: null });
      existing(chatId, messageId, "deleteMessage");
      chat(chatId).delete(messageId);
    },
    async answerCallbackQuery(_callbackQueryId, text) {
      record({ method: "answerCallbackQuery", chatId: null, messageId: null, text: text ?? null, keyboard: null });
    },
  };
}
