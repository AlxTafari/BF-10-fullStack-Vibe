export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  // type = 'private' | 'group' | 'supergroup' | 'channel'; удалять/править сообщения бот умеет только в личных чатах.
  chat: { id: number; type?: string };
  text?: string;
  voice?: TelegramVoice;
}

/** Голосовое (S09). file_id — ключ для getFile: по нему бот скачивает файл и позже (кнопка в админке). */
export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  /** Длительность в секундах — по ней проверяем предел до скачивания. */
  duration: number;
  /** Обычно audio/ogg (Opus); Telegram может не прислать. */
  mime_type?: string;
  file_size?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];
