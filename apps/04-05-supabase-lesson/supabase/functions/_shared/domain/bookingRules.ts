// Правила брони: какие даты, периоды и часы можно предложить гостю и что считать допустимым слотом.
// Чистые функции: «сейчас» и часовой пояс передаются аргументами (тесты не зависят от часов машины).
import { addDays, diffDays, isValidDateString, isoWeekday, localNow } from "./zonedTime.ts";

export type PeriodId = "lunch" | "dinner";

/** Границы периодов, часы включительно: «Обед» = 12:00…16:00, «Ужин» = 17:00…22:00. Подогнаны под Лавраки; при смене ресторана — данные (S04). */
export const BOOKING_PERIODS: Record<PeriodId, { fromHour: number; toHour: number }> = {
  lunch: { fromHour: 12, toHour: 16 },
  dinner: { fromHour: 17, toHour: 22 },
};
export const PERIOD_IDS = Object.keys(BOOKING_PERIODS) as PeriodId[];

/** Сколько дней вперёд показываем кнопками. */
export const DATE_BUTTONS_DAYS = 14;
/** Дальше этого срока бронь не принимаем, даже если дата корректна. */
export const MAX_DAYS_AHEAD = 60;
/** На сегодня часы не раньше «сейчас + N минут». */
export const MIN_LEAD_MINUTES = 30;

/** Часы работы по дням: ключ — ISO-день недели ("1" = понедельник), нет ключа = выходной. */
export type OpeningHours = Record<string, { open: string; close: string }>;

export interface BookingEnv {
  now: Date;
  timeZone: string;
  /** null = часы неизвестны, бронь по часам не ограничиваем. */
  openingHours: OpeningHours | null;
  minLeadMinutes?: number;
}

export type SlotError = "bad_date" | "date_in_past" | "date_too_far" | "bad_time" | "closed" | "too_soon";

/** "13:00" → 780, "24:00" → 1440. NaN-значение (битый json) → null. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]);
  return total <= 24 * 60 ? total : null;
}

/** Окно работы в этот день в минутах от полуночи; null — выходной. */
export function workingWindow(openingHours: OpeningHours | null, date: string): { open: number; close: number } | null {
  if (openingHours === null) return { open: 0, close: 24 * 60 };
  const day = openingHours[String(isoWeekday(date))];
  if (!day) return null;
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  // Битые данные в БД трактуем как «закрыто»: безопаснее не принять бронь, чем принять в неизвестное время.
  if (open === null || close === null) return null;
  return { open, close };
}

/** Часы периода, доступные для брони на дату (пусто — период недоступен). */
export function availableHours(date: string, period: PeriodId, env: BookingEnv): number[] {
  if (!isValidDateString(date)) return [];
  const today = localNow(env.now, env.timeZone);
  const daysAhead = diffDays(today.date, date);
  if (daysAhead < 0 || daysAhead > MAX_DAYS_AHEAD) return [];

  const window = workingWindow(env.openingHours, date);
  if (!window) return [];
  const earliest = daysAhead === 0 ? today.minutes + (env.minLeadMinutes ?? MIN_LEAD_MINUTES) : 0;

  const { fromHour, toHour } = BOOKING_PERIODS[period];
  const hours: number[] = [];
  for (let h = fromHour; h <= toHour; h++) {
    const start = h * 60;
    // Закрытие — не включительно: при close 24:00 последний час брони 23:00.
    if (start >= window.open && start < window.close && start >= earliest) hours.push(h);
  }
  return hours;
}

export function availablePeriods(date: string, env: BookingEnv): PeriodId[] {
  return PERIOD_IDS.filter((p) => availableHours(date, p, env).length > 0);
}

/** Даты ближайших DATE_BUTTONS_DAYS дней, на которые есть хотя бы один свободный час. Выходные и закрытое «сегодня» пропускаются. */
export function availableDates(env: BookingEnv): string[] {
  const today = localNow(env.now, env.timeZone).date;
  const dates: string[] = [];
  for (let i = 0; i < DATE_BUTTONS_DAYS; i++) {
    const date = addDays(today, i);
    if (availablePeriods(date, env).length > 0) dates.push(date);
  }
  return dates;
}

export function todayIn(env: BookingEnv): string {
  return localNow(env.now, env.timeZone).date;
}

/**
 * Полная проверка слота (дата + время) — её зовут и сценарий, и сервис создания заявки.
 * Принимает только целые часы внутри периодов Обед/Ужин и часов работы.
 */
export function validateSlot(date: string, time: string, env: BookingEnv): { ok: true } | { ok: false; error: SlotError } {
  if (!isValidDateString(date)) return { ok: false, error: "bad_date" };
  const today = localNow(env.now, env.timeZone).date;
  const daysAhead = diffDays(today, date);
  if (daysAhead < 0) return { ok: false, error: "date_in_past" };
  if (daysAhead > MAX_DAYS_AHEAD) return { ok: false, error: "date_too_far" };

  const m = /^(\d{2}):00$/.exec(time);
  if (!m) return { ok: false, error: "bad_time" };
  const hour = Number(m[1]);
  const period = PERIOD_IDS.find((p) => hour >= BOOKING_PERIODS[p].fromHour && hour <= BOOKING_PERIODS[p].toHour);
  if (!period) return { ok: false, error: "bad_time" };

  if (availableHours(date, period, env).includes(hour)) return { ok: true };
  // Час допустим по периоду, но недоступен: различаем «закрыто» и «уже слишком скоро».
  const window = workingWindow(env.openingHours, date);
  const open = window && hour * 60 >= window.open && hour * 60 < window.close;
  return { ok: false, error: open ? "too_soon" : "closed" };
}
