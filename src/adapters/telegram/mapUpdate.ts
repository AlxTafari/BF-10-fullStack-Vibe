import type { IncomingMessage } from "../../application/useCases/handleIncomingMessage.js";
import type { TelegramUpdate } from "./telegramTypes.js";

/**
 * Переводит Telegram Update во внутренний IncomingMessage.
 * Возвращает null, если в апдейте нет текстового сообщения
 * (стикеры, вступления в чат, callback'и и т.п. — игнорируем).
 */
export function mapUpdate(update: TelegramUpdate): IncomingMessage | null {
  const message = update.message ?? update.edited_message;
  if (!message || typeof message.text !== "string") {
    return null;
  }
  return {
    chatId: message.chat.id,
    text: message.text,
    chatType: message.chat.type,
  };
}
