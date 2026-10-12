import { buildCallback } from "./domain/callbackData.ts";
import { formatPrice } from "./domain/formatPrice.ts";
import type { FaqListItem } from "./services/faq.ts";
import type { DishSummary } from "./services/menu.ts";
import type { InlineKeyboard } from "./telegram/types.ts";
import type { MenuCategoryRow } from "./types.ts";

// callback_data кнопок главного меню. Префикс menu: — по нему роутер отличает их от кнопок других экранов.
export const MENU_INFO = "menu:info";
export const MENU_MENU = "menu:menu";
export const MENU_FAQ = "menu:faq";
export const MENU_BOOKING = "menu:booking";
export const MENU_MANAGER = "menu:manager";
export const MENU_MAIN = "menu:main";

export const MAIN_MENU_KEYBOARD: InlineKeyboard = [
  [{ text: "ℹ️ О ресторане", callback_data: MENU_INFO }],
  [{ text: "🍽 Меню", callback_data: MENU_MENU }],
  [{ text: "❓ Частые вопросы", callback_data: MENU_FAQ }],
  [{ text: "📅 Забронировать стол", callback_data: MENU_BOOKING }],
  [{ text: "💬 Связаться с менеджером", callback_data: MENU_MANAGER }],
];

export const MENU_PROMPT = "Выберите, что вас интересует:";

// Свободный текст = поиск блюда по названию (S02).
export const SEARCH_HINT = "Напишите название блюда (от 2 букв) или выберите пункт меню 👇";
export const SEARCH_NOT_FOUND = "Не нашёл такого блюда. Попробуйте другое слово или откройте меню 👇";
export const SEARCH_CHOOSE = "Нашлось несколько блюд, уточните:";
export const SEARCH_TOO_MANY = "Найдено больше, чем я могу показать. Уточните запрос — вот первые:";

export const FAQ_PROMPT = "Выберите вопрос:";
export const FAQ_EMPTY = "Раздел пока не заполнен. Уточните у персонала.";
export const FAQ_NOT_FOUND = "Такого вопроса нет.";
export const MENU_CATEGORIES_PROMPT = "Выберите категорию:";
export const MENU_EMPTY = "Меню пока не заполнено. Уточните у персонала.";
export const DISH_NOT_FOUND = "Такого блюда нет в меню.";

export function categoryPrompt(name: string): string {
  return `Категория «${name}»:`;
}

// Разделы, которые появятся в следующих спринтах (S03).
export const SECTION_STUB = "Этот раздел скоро появится.";

export function welcomeText(restaurantName: string): string {
  return `Добро пожаловать в ${restaurantName}! Я помогу узнать о ресторане, меню и оставить заявку.`;
}

export const NO_RESTAURANT_TEXT = "Информация о ресторане пока не заполнена. Попробуйте позже.";

// ---------------------------------------------------------------- клавиатуры S02

const HOME_BUTTON = { text: "🏠 Главное меню", callback_data: MENU_MAIN };

export const HOME_KEYBOARD: InlineKeyboard = [[HOME_BUTTON]];

export const MENU_AND_HOME_KEYBOARD: InlineKeyboard = [
  [{ text: "🍽 Меню", callback_data: MENU_MENU }],
  [HOME_BUTTON],
];

export function faqListKeyboard(items: FaqListItem[]): InlineKeyboard {
  return [...items.map((i) => [{ text: i.question, callback_data: buildCallback("faq", i.id) }]), [HOME_BUTTON]];
}

export const FAQ_ANSWER_KEYBOARD: InlineKeyboard = [
  [{ text: "← К вопросам", callback_data: MENU_FAQ }],
  [HOME_BUTTON],
];

export function categoriesKeyboard(categories: MenuCategoryRow[]): InlineKeyboard {
  return [
    ...categories.map((c) => [{ text: c.name, callback_data: buildCallback("category", c.id) }]),
    [HOME_BUTTON],
  ];
}

/** Подпись кнопки блюда: цена и, если блюда сейчас нет, пометка — недоступное нельзя выдавать за доступное. */
function dishButtonText(d: DishSummary): string {
  const unavailable = d.isAvailable ? "" : " (недоступно)";
  return `${d.name} — ${formatPrice(d.price, d.currency)}${unavailable}`;
}

/** Список блюд; `back` — кнопка «назад» (к категориям из категории, в меню из поиска). */
export function dishListKeyboard(items: DishSummary[], back: { text: string; callback_data: string }): InlineKeyboard {
  return [
    ...items.map((d) => [{ text: dishButtonText(d), callback_data: buildCallback("dish", d.id) }]),
    [back],
    [HOME_BUTTON],
  ];
}

export const BACK_TO_CATEGORIES = { text: "← К категориям", callback_data: MENU_MENU };
export const BACK_TO_MENU = { text: "🍽 Меню", callback_data: MENU_MENU };

export function dishCardKeyboard(category: { id: string; name: string | null } | null): InlineKeyboard {
  const back = category
    ? { text: `← В «${category.name ?? "категорию"}»`, callback_data: buildCallback("category", category.id) }
    : BACK_TO_CATEGORIES;
  return [[back], [HOME_BUTTON]];
}
