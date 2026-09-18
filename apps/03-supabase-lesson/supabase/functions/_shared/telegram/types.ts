export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number };
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramInlineQuery {
  id: string;
  from: TelegramUser;
  query: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  inline_query?: TelegramInlineQuery;
}

export interface InlineKeyboardButton {
  text: string;
  // ровно одно из двух: callback_data (обычная кнопка) или switch_inline_query_current_chat
  // (тап вставляет "@bot_username <prefill>" в поле ввода текущего чата, без отправки).
  callback_data?: string;
  switch_inline_query_current_chat?: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

// Постоянное меню снизу экрана — тап по кнопке просто отправляет её текст как обычное сообщение.
export type ReplyKeyboard = string[][];

export interface InlineQueryResultArticle {
  type: "article";
  id: string;
  title: string;
  description?: string;
  input_message_content: { message_text: string };
}
