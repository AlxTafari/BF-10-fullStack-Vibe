/**
 * Минимальные типы Telegram Bot API — только то, что реально читаем.
 * Полная схема: https://core.telegram.org/bots/api
 */

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}
