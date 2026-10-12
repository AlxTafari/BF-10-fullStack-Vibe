import type { InlineKeyboard } from "./telegram/types.ts";

// callback_data кнопок главного меню. Префикс menu: — по нему роутер отличает их от кнопок других экранов.
export const MENU_INFO = "menu:info";
export const MENU_MENU = "menu:menu";
export const MENU_FAQ = "menu:faq";
export const MENU_BOOKING = "menu:booking";
export const MENU_MANAGER = "menu:manager";

export const MAIN_MENU_KEYBOARD: InlineKeyboard = [
  [{ text: "ℹ️ О ресторане", callback_data: MENU_INFO }],
  [{ text: "🍽 Меню", callback_data: MENU_MENU }],
  [{ text: "❓ Частые вопросы", callback_data: MENU_FAQ }],
  [{ text: "📅 Забронировать стол", callback_data: MENU_BOOKING }],
  [{ text: "💬 Связаться с менеджером", callback_data: MENU_MANAGER }],
];

export const MENU_PROMPT = "Выберите, что вас интересует:";

export const FREE_TEXT_HINT = "Я пока отвечаю только по кнопкам меню 👇";

// Разделы, которые появятся в следующих спринтах (S02, S03).
export const SECTION_STUB = "Этот раздел скоро появится.";

export function welcomeText(restaurantName: string): string {
  return `Добро пожаловать в ${restaurantName}! Я помогу узнать о ресторане, меню и оставить заявку.`;
}

export const NO_RESTAURANT_TEXT = "Информация о ресторане пока не заполнена. Попробуйте позже.";
