import { z } from "zod";
import { type HoursState, fromDb, toDb, validateHours } from "./openingHours";

/** Валюты в выпадающем списке. Код вне списка (например, заведённый руками в БД) редактор добавляет сам. */
export const CURRENCIES = [
  "EUR", "RUB", "USD", "GBP", "CHF", "PLN", "CZK", "UAH", "BYN", "KZT", "TRY", "GEL", "AED", "CNY", "JPY",
] as const;

function isValidTimezone(tz: string): boolean {
  try {
    // Бросает RangeError на неизвестном поясе. Надёжнее, чем искать в supportedValuesOf: там нет, например, "UTC".
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Значения формы — строки как в полях ввода; пустая строка превращается в null позже, в toRestaurantUpdate.
 * Так форма остаётся простой, а правила «пусто → null» живут в одном месте и тестируются.
 */
export const restaurantSchema = z.object({
  name: z.string().trim().min(1, "Введите название").max(120, "Не длиннее 120 символов"),
  description: z.string().trim().max(2000, "Не длиннее 2000 символов"),
  address: z.string().trim().max(300, "Не длиннее 300 символов"),
  phone: z.string().trim().max(50, "Не длиннее 50 символов"),
  email: z
    .string()
    .trim()
    .max(200, "Не длиннее 200 символов")
    // Пустой email допустим (→ null); если задан — проверяем формат.
    .refine((v) => v === "" || z.email().safeParse(v).success, "Некорректный email"),
  timezone: z.string().trim().min(1, "Выберите часовой пояс").refine(isValidTimezone, "Неизвестный часовой пояс"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Код валюты: три латинские буквы, например EUR"),
  working_hours: z.string().trim().max(300, "Не длиннее 300 символов"),
  // Целое со знаком: id группового чата в Telegram отрицательный. Пусто = уведомления выключены.
  manager_chat_id: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^-?\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) !== 0), "Целое число, не 0"),
  hours: z.custom<HoursState>().superRefine((hours, ctx) => {
    // Ошибки по дням собираем в одно сообщение: редактор сам подсвечивает, какой день, а форме нужен общий блок.
    if (Object.keys(validateHours(hours)).length > 0) {
      ctx.addIssue({ code: "custom", message: "Исправьте часы работы" });
    }
  }),
});

export type RestaurantFormValues = z.infer<typeof restaurantSchema>;

/** Поля таблицы restaurants, которые правит админка. */
export interface RestaurantUpdate {
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  currency: string;
  working_hours: string | null;
  opening_hours: ReturnType<typeof toDb>;
  manager_chat_id: number | null;
}

/** Строка restaurants (нужные поля) в виде, удобном форме. */
export interface RestaurantRecord {
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  currency: string;
  working_hours: string | null;
  opening_hours: unknown;
  manager_chat_id: number | null;
}

/** БД → значения формы: null становится пустой строкой. */
export function toFormValues(r: RestaurantRecord): RestaurantFormValues {
  return {
    name: r.name,
    description: r.description ?? "",
    address: r.address ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    timezone: r.timezone,
    currency: r.currency,
    working_hours: r.working_hours ?? "",
    manager_chat_id: r.manager_chat_id === null ? "" : String(r.manager_chat_id),
    hours: fromDb(r.opening_hours),
  };
}

const emptyToNull = (v: string): string | null => (v === "" ? null : v);

/** Значения формы (уже прошедшие схему) → patch для update. Пустая строка → null. */
export function toRestaurantUpdate(v: RestaurantFormValues): RestaurantUpdate {
  const name = v.name.trim();
  const chatId = v.manager_chat_id.trim();
  return {
    name,
    description: emptyToNull(v.description.trim()),
    address: emptyToNull(v.address.trim()),
    phone: emptyToNull(v.phone.trim()),
    email: emptyToNull(v.email.trim()),
    timezone: v.timezone.trim(),
    currency: v.currency,
    working_hours: emptyToNull(v.working_hours.trim()),
    opening_hours: toDb(v.hours),
    manager_chat_id: chatId === "" ? null : Number(chatId),
  };
}
