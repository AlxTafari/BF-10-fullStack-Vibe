import { BOOKING_PERIODS, type PeriodId } from "./domain/bookingRules.ts";
import { buildBookingCallback, buildCallback, buildFlowCallback } from "./domain/callbackData.ts";
import { COMMENT_MAX, GUESTS_MAX, REQUEST_TEXT_MAX } from "./domain/fieldValidation.ts";
import type { FlowErrorCode, FlowReply, GuestRequestKind } from "./domain/flowState.ts";
import { formatBookingShort, formatGuestRequestLine, type MyBooking, type MyGuestRequest } from "./domain/myRequests.ts";
import { addDays } from "./domain/zonedTime.ts";
import { formatDate, GUEST_REQUEST_KIND_LABEL } from "./domain/requestSummaries.ts";
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
export const MENU_MY = "menu:my";
export const MENU_MAIN = "menu:main";

export const MAIN_MENU_KEYBOARD: InlineKeyboard = [
  [{ text: "ℹ️ О ресторане", callback_data: MENU_INFO }],
  [{ text: "🍽 Меню", callback_data: MENU_MENU }],
  [{ text: "❓ Частые вопросы", callback_data: MENU_FAQ }],
  [{ text: "📅 Забронировать стол", callback_data: MENU_BOOKING }],
  [{ text: "💬 Связаться с менеджером", callback_data: MENU_MANAGER }],
  [{ text: "📋 Мои заявки", callback_data: MENU_MY }],
];

export const MENU_PROMPT = "Выберите, что вас интересует:";

// Свободный текст = поиск блюда по названию (S02).
// Антиспам (S06c). Тексты не цитируют сообщение гостя: оно может быть длинным и содержать личные данные.
export const RATE_LIMIT_WARNING = "Слишком много сообщений. Подождите немного и попробуйте снова.";
export const TEXT_TOO_LONG = "Сообщение слишком длинное — максимум 500 символов. Напишите короче.";

export const SEARCH_HINT = "Напишите название блюда (от 2 букв) или выберите пункт меню 👇";
export const SEARCH_NOT_FOUND = "Не нашёл такого блюда. Попробуйте другое слово или откройте меню 👇";
export const SEARCH_CHOOSE = "Нашлось несколько блюд, уточните:";
export const CATEGORY_TRUNCATED = "В категории больше блюд, чем я могу показать. Остальные найдите по названию — просто напишите его.";
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

// ---------------------------------------------------------------- сценарии брони и обращений (S03)

export const FLOW_CANCELLED = "Отменено. Ничего не отправлено.";
export const FLOW_STALE = "Эта заявка уже неактуальна.";
// Тексты после отправки не обещают лишнего: бронь не подтверждена, сроков ответа нет.
export const BOOKING_SENT = "Заявка передана ресторану. Бронь пока не подтверждена — ожидайте ответа менеджера.";
export const GUEST_REQUEST_SENT = "Обращение передано менеджеру.";
export const SUBMIT_FAILED = "Не удалось отправить, нажмите ещё раз.";
export const SUBMIT_REJECTED = "Не удалось отправить: данные заявки больше не подходят. Давайте начнём заново.";

const CANCEL_BUTTON_TEXT = "✖️ Отмена";

const PERIOD_LABEL: Record<PeriodId, string> = { lunch: "🍽 Обед", dinner: "🌙 Ужин" };

/** Причина, по которой ввод не принят. Гость видит её над повторным вопросом того же шага. */
const FLOW_ERROR_TEXT: Record<FlowErrorCode, string> = {
  use_buttons: "Выберите вариант кнопкой ниже 👇",
  unavailable: "Этот вариант уже недоступен. Выберите другой.",
  contact_required: "Для вопроса менеджеру нужен контакт — без него мы не сможем ответить.",
  guests_not_integer: "Напишите число гостей цифрами, например 4.",
  guests_too_few: "Гостей должно быть не меньше одного.",
  guests_too_many: `Не больше ${GUESTS_MAX} гостей.`,
  name_too_short: "Имя слишком короткое — минимум 2 символа.",
  name_too_long: "Имя слишком длинное — до 60 символов.",
  contact_invalid: "Не похоже на контакт. Напишите телефон (10–15 цифр) или @username.",
  comment_too_long: `Комментарий слишком длинный — до ${COMMENT_MAX} символов.`,
  text_empty: "Сообщение пустое. Напишите текст.",
  text_too_long: `Слишком длинно — до ${REQUEST_TEXT_MAX} символов.`,
  bad_date: "Такой даты нет. Выберите дату кнопкой.",
  date_in_past: "Эта дата уже прошла. Выберите другую.",
  date_too_far: "Так далеко вперёд бронь не принимается. Выберите дату поближе.",
  bad_time: "Выберите время кнопкой.",
  closed: "В это время ресторан не работает. Выберите другое.",
  too_soon: "На это время уже не успеть. Выберите более позднее.",
};

export function flowErrorText(error: FlowErrorCode): string {
  return FLOW_ERROR_TEXT[error];
}

/** Подпись кнопки даты: «Сегодня», «Завтра», дальше «вт, 20.10». */
function dateButtonText(date: string, today: string): string {
  if (date === today) return "Сегодня";
  if (date === addDays(today, 1)) return "Завтра";
  return formatDate(date).slice(0, -5); // «вт, 20.10.2026» → «вт, 20.10»
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** Экран сценария: текст и кнопки. Кнопки привязаны к draftId — старые сводки в чате не влияют на новую заявку. */
export function renderFlowReply(draftId: string, reply: FlowReply): { text: string; keyboard: InlineKeyboard } {
  const btn = (text: string, action: string) => ({ text, callback_data: buildFlowCallback(draftId, action) });
  const { screen } = reply;
  // «Назад» есть на всех шагах, кроме первых (дата, тип обращения) и экрана «слишком много гостей» (там просто введите число).
  const hasBack = !["ask_date", "no_dates", "ask_kind", "too_many_guests"].includes(screen.screen);
  const cancel = hasBack
    ? [btn("← Назад", "back"), btn(CANCEL_BUTTON_TEXT, "cancel")]
    : [btn(CANCEL_BUTTON_TEXT, "cancel")];

  let text: string;
  let keyboard: InlineKeyboard;
  switch (screen.screen) {
    case "ask_date":
      text = "На какую дату?";
      keyboard = [
        ...chunk(screen.dates.map((d) => btn(dateButtonText(d, screen.today), `d=${d}`)), 3),
        cancel,
      ];
      break;
    case "no_dates":
      text = "В ближайшие дни записаться через бота нельзя. Свяжитесь с менеджером.";
      keyboard = [[{ text: "💬 Связаться с менеджером", callback_data: MENU_MANAGER }], cancel];
      break;
    case "ask_period":
      text = `${formatDate(screen.date)}. Когда вам удобнее?`;
      keyboard = [screen.periods.map((p) => btn(PERIOD_LABEL[p], `p=${p}`)), cancel];
      break;
    case "ask_hour": {
      const { fromHour, toHour } = BOOKING_PERIODS[screen.period];
      text = `${PERIOD_LABEL[screen.period]} (${fromHour}:00–${toHour}:00). Выберите время:`;
      keyboard = [
        ...chunk(screen.hours.map((h) => btn(`${String(h).padStart(2, "0")}:00`, `h=${h}`)), 4),
        cancel,
      ];
      break;
    }
    case "ask_guests":
      text = `Сколько будет гостей? Напишите число от 1 до ${GUESTS_MAX}.`;
      keyboard = [
        ...(screen.keepGuests !== undefined ? [[btn(`Оставить ${screen.keepGuests}`, "keep")]] : []),
        cancel,
      ];
      break;
    case "too_many_guests":
      text = `Для компаний больше ${GUESTS_MAX} человек свяжитесь с менеджером — он всё обсудит.`;
      keyboard = [[btn("💬 Связаться с менеджером", "to_manager")], cancel];
      break;
    case "ask_name":
      text = "На чьё имя оформить заявку?";
      keyboard = [cancel];
      break;
    case "ask_contact": {
      text = screen.optional
        ? "Если хотите получить ответ — оставьте телефон или @username. Можно пропустить."
        : "Как с вами связаться? Напишите телефон или @username.";
      const row = [];
      if (screen.canUseUsername) row.push(btn("Использовать мой @username", "me"));
      if (screen.optional) row.push(btn("Пропустить", "skip"));
      keyboard = [...row.map((b) => [b]), cancel];
      break;
    }
    case "ask_comment":
      text = `Пожелания к заявке (например, детский стул или стол у окна)? Напишите текст до ${COMMENT_MAX} символов или пропустите.`;
      keyboard = [[btn("Пропустить", "skip")], cancel];
      break;
    case "ask_kind":
      text = "Что вы хотите отправить?";
      keyboard = [
        ...(["feedback", "complaint", "manager_request"] as GuestRequestKind[]).map((k) => [
          btn(GUEST_REQUEST_KIND_LABEL[k], `k=${k}`),
        ]),
        cancel,
      ];
      break;
    case "ask_text":
      text = screen.kind === "manager_request" ? "Напишите ваш вопрос менеджеру:" : `Напишите ваш текст (${GUEST_REQUEST_KIND_LABEL[screen.kind].toLowerCase()}):`;
      keyboard = [cancel];
      break;
    case "confirm":
      text = screen.isChange
        ? `Проверьте изменение:\n\n${screen.summary}\n\nЭто запрос на изменение. Текущая бронь остаётся в силе, пока менеджер не подтвердит новую.`
        : screen.flow === "booking"
        ? `Проверьте заявку:\n\n${screen.summary}\n\nЭто заявка, а не подтверждённая бронь. Менеджер рассмотрит её и ответит вам.`
        : `Проверьте обращение:\n\n${screen.summary}`;
      keyboard = [[btn("✅ Отправить", "send")], [btn("🔄 Начать заново", "restart")], cancel];
      break;
    case "submit":
      // Экран-сигнал для вызывающего: показывать нечего, заявку создаёт обработчик.
      throw new Error("submit — не экран, а команда создать заявку");
  }
  return { text: reply.error ? `⚠️ ${flowErrorText(reply.error)}\n\n${text}` : text, keyboard };
}

/** Кнопка «Отправить» для повтора после сбоя: старая сводка в чате далеко, а нажать нужно ту же заявку. */
export function retrySubmitKeyboard(draftId: string): InlineKeyboard {
  return [[{ text: "✅ Отправить", callback_data: buildFlowCallback(draftId, "send") }]];
}

// ---------------------------------------------------------------- «Мои заявки»

export const MY_REQUESTS_EMPTY = "У вас пока нет заявок.";
export const MY_REQUESTS_TITLE = "📋 Ваши заявки";
export const MY_BOOKING_NOT_FOUND = "Заявка не найдена.";
export const CANCEL_CONFIRM_TEXT = "Отменить эту бронь? Менеджер получит уведомление.";
export const CANCEL_DONE = "Бронь отменена. Менеджер уведомлён.";
export const CANCEL_CHANGE_DONE = "Запрос на изменение отменён. Прежняя бронь остаётся в силе.";
export const CANCEL_NOT_POSSIBLE = "Эту заявку уже нельзя отменить: она отменена, прошла или обработана.";
export const CHANGE_NOT_POSSIBLE = "Эту бронь сейчас нельзя изменить: она не активна или изменение уже запрошено.";
export const CHANGE_SENT = "Запрос на изменение передан. Текущая бронь остаётся в силе, пока менеджер не подтвердит новую.";
export const CHANGE_REJECTED = "Не удалось отправить изменение: бронь уже нельзя менять или изменение уже запрошено.";

const BACK_TO_MY_LIST = { text: "← К списку", callback_data: MENU_MY };

export function renderMyRequests(
  bookings: MyBooking[],
  requests: MyGuestRequest[],
  timeZone: string,
): { text: string; keyboard: InlineKeyboard } {
  if (bookings.length === 0 && requests.length === 0) return { text: MY_REQUESTS_EMPTY, keyboard: HOME_KEYBOARD };
  const parts = [MY_REQUESTS_TITLE];
  if (requests.length > 0) parts.push("", "Обращения:", ...requests.map(formatGuestRequestLine));
  if (bookings.length > 0) parts.push("", "Брони — выберите, чтобы открыть:");
  return {
    text: parts.join("\n"),
    keyboard: [
      ...bookings.map((b) => [{ text: formatBookingShort(b, timeZone), callback_data: buildBookingCallback(b.id) }]),
      [HOME_BUTTON],
    ],
  };
}

export function bookingCardKeyboard(bookingId: string, canChange: boolean, canCancel: boolean): InlineKeyboard {
  const actions = [];
  if (canChange) actions.push({ text: "✏️ Изменить", callback_data: buildBookingCallback(bookingId, "ch") });
  if (canCancel) actions.push({ text: "❌ Отменить", callback_data: buildBookingCallback(bookingId, "x") });
  return [...(actions.length > 0 ? [actions] : []), [BACK_TO_MY_LIST], [HOME_BUTTON]];
}

export function cancelConfirmKeyboard(bookingId: string): InlineKeyboard {
  return [
    [{ text: "Да, отменить", callback_data: buildBookingCallback(bookingId, "xy") }],
    [{ text: "Нет", callback_data: buildBookingCallback(bookingId) }],
  ];
}

export const MY_LIST_AND_HOME_KEYBOARD: InlineKeyboard = [[BACK_TO_MY_LIST], [HOME_BUTTON]];
