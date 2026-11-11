// Черновик брони от агента (S09, сессия 3). Агент разобрал фразу гостя («стол на завтра в 19 на четверых») и передал
// поля; здесь они проверяются теми же правилами, что ручной ввод, и ложатся в ТОТ ЖЕ BookingState, что у кнопочного
// сценария S03 (§4.7). Шаг ставится на первое незаполненное поле: следующий ответ гостя («Анна») обработает обычный
// шаг сценария, без LLM. Заявку не создаёт — только кнопка гостя «Отправить».
// Чистая функция: БД, Telegram и LLM не знает.
import {
  availableHours,
  availablePeriods,
  BOOKING_PERIODS,
  type BookingEnv,
  MAX_DAYS_AHEAD,
  PERIOD_IDS,
  type PeriodId,
  type SlotError,
  todayIn,
  validateSlot,
} from "./bookingRules.ts";
import { bookingScreen, startBooking } from "./bookingFlow.ts";
import { validateComment, validateContact, validateGuests, validateName } from "./fieldValidation.ts";
import type { BookingData, BookingState, BookingStep, DraftError, DraftOutcome, FlowEnv, FlowState } from "./flowState.ts";
import { diffDays, isValidDateString } from "./zonedTime.ts";

/** Поля, которые агент может передать. Дата — YYYY-MM-DD в зоне ресторана, время — целый час «19:00». */
export interface BookingDraftInput {
  date?: string;
  time?: string;
  guests?: number | string;
  name?: string;
  contact?: string;
  comment?: string;
}

export type BookingDraftField = keyof BookingDraftInput;

export type BookingDraftOutcome = DraftOutcome<BookingDraftField> & {
  /** Есть, если время не принято, а дата известна: свободные часы этой даты, чтобы агент предложил их гостю. */
  freeHours?: string[];
};

const hhmm = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * «19», «19:00», «7:00» → «19:00» / «07:00». Бронь — только на целые часы (как кнопки): «19:30» → null.
 */
export function normalizeHour(time: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m || (m[2] !== undefined && m[2] !== "00")) return null;
  const hour = Number(m[1]);
  return hour <= 23 ? hhmm(hour) : null;
}

/** Период, в который попадает час: кнопочный сценарий хранит его рядом со временем (шаг «период»). */
function periodOf(time: string): PeriodId | undefined {
  const hour = Number(time.slice(0, 2));
  return PERIOD_IDS.find((p) => hour >= BOOKING_PERIODS[p].fromHour && hour <= BOOKING_PERIODS[p].toHour);
}

/** Дата сама по себе: существует, не в прошлом, не слишком далеко и в этот день есть хоть один час для брони. */
function dateError(date: string, be: BookingEnv): SlotError | null {
  if (!isValidDateString(date)) return "bad_date";
  const ahead = diffDays(todayIn(be), date);
  if (ahead < 0) return "date_in_past";
  if (ahead > MAX_DAYS_AHEAD) return "date_too_far";
  return availablePeriods(date, be).length === 0 ? "closed" : null;
}

/** Все свободные для брони часы даты, по возрастанию. */
export function freeHoursOn(date: string, be: BookingEnv): string[] {
  return PERIOD_IDS.flatMap((p) => availableHours(date, p, be)).sort((a, b) => a - b).map(hhmm);
}

const FULL_ORDER: BookingStep[] = ["date", "period", "hour", "guests", "name", "contact", "comment", "confirm"];
/** При изменении брони имя, контакт и комментарий не спрашиваем — как в bookingFlow.ts. */
const CHANGE_ORDER: BookingStep[] = ["date", "period", "hour", "guests", "confirm"];

function isFilled(step: BookingStep, d: BookingData): boolean {
  switch (step) {
    case "date":
      return !!d.date;
    case "period":
      return !!d.period;
    case "hour":
      return !!d.time;
    case "guests":
      return d.guests !== undefined;
    case "name":
      return !!d.name;
    case "contact":
      return !!d.contact;
    case "comment":
      return d.comment !== undefined;
    case "confirm":
      return false;
  }
}

/**
 * Применяет поля от агента к черновику брони. current — живой сценарий диалога: бронь дополняется (в том числе
 * начатая кнопками), обращение или отсутствие сценария — начинается новая бронь.
 * Непрошедшее проверку поле не пишется и попадает в errors; принятое раньше не стирается.
 */
export function applyBookingDraft(current: FlowState | null, input: BookingDraftInput, env: FlowEnv): BookingDraftOutcome {
  const be: BookingEnv = { now: env.now, timeZone: env.timeZone, openingHours: env.openingHours };
  // startBooking типизирован общим AdvanceResult, но всегда возвращает бронь.
  const base = current?.flow === "booking" ? current : (startBooking(env).state as BookingState);
  const isChange = !!base.change;
  const data: BookingData = { ...base.data };
  const accepted: BookingDraftField[] = [];
  const errors: Partial<Record<BookingDraftField, DraftError>> = {};

  // Дата. Новая дата сбрасывает прежнее время — ниже оно вернётся, если подходит и для новой даты.
  const prevTime = data.time;
  let dateChanged = false;
  if (input.date !== undefined) {
    const error = dateError(input.date, be);
    if (error) errors.date = error;
    else {
      dateChanged = input.date !== data.date;
      if (dateChanged) {
        data.date = input.date;
        delete data.period;
        delete data.time;
      }
      accepted.push("date");
    }
  }

  // Время: проверяется только вместе с датой (часы работы зависят от дня недели, «сегодня» — от текущего часа).
  if (input.time !== undefined) {
    const time = normalizeHour(input.time);
    if (!time) errors.time = "bad_time";
    else if (!data.date) errors.time = "needs_date";
    else {
      const slot = validateSlot(data.date, time, be);
      if (slot.ok) {
        data.time = time;
        data.period = periodOf(time);
        accepted.push("time");
      } else errors.time = slot.error;
    }
  } else if (dateChanged && prevTime && validateSlot(data.date!, prevTime, be).ok) {
    data.time = prevTime;
    data.period = periodOf(prevTime);
  }

  if (input.guests !== undefined) {
    const v = validateGuests(input.guests);
    if (v.ok) {
      data.guests = v.value;
      accepted.push("guests");
    } else errors.guests = v.error;
  }

  // Имя, контакт, комментарий: при изменении брони они берутся из исходной и не меняются.
  const personal: [BookingDraftField, string | undefined, (s: string) => { ok: boolean; value?: unknown; error?: DraftError }][] = [
    ["name", input.name, validateName],
    ["contact", input.contact, validateContact],
    ["comment", input.comment, validateComment],
  ];
  for (const [field, value, validate] of personal) {
    if (value === undefined) continue;
    if (isChange) {
      errors[field] = "not_editable";
      continue;
    }
    const v = validate(value);
    if (v.ok) {
      (data as Record<string, unknown>)[field] = v.value;
      accepted.push(field);
    } else errors[field] = v.error;
  }

  const order = isChange ? CHANGE_ORDER : FULL_ORDER;
  // Комментарий в диалоге не спрашиваем (§5 п.5: «только недостающее»): гость его не назвал — null. Шаг контакта
  // кнопочного сценария увидит решённый комментарий и сразу перейдёт к сводке. Добавить его можно и позже:
  // агент передаст comment, черновик дополнится.
  if (!isChange && data.comment === undefined) data.comment = null;
  const step = order.find((s) => !isFilled(s, data)) ?? "confirm";

  const state: BookingState = { ...base, step, data, touchedAt: env.now.toISOString() };
  const missing: BookingDraftField[] = [];
  if (!data.date) missing.push("date");
  if (!data.time) missing.push("time");
  if (data.guests === undefined) missing.push("guests");
  if (!isChange && !data.name) missing.push("name");
  if (!isChange && !data.contact) missing.push("contact");

  return {
    result: { state, reply: { screen: bookingScreen(state, env) } },
    accepted,
    errors,
    missing,
    ...(errors.time && data.date ? { freeHours: freeHoursOn(data.date, be) } : {}),
  };
}
