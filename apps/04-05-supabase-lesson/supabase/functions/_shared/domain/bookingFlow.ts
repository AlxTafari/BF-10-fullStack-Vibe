// Сценарий брони: дата → период → час → гости → имя (можно сразу с контактом) → контакт → сводка «Что-нибудь ещё?»
// (текст дописывается в пожелания) → подтверждение.
// advance — чистая функция: (состояние, ввод, окружение) → (новое состояние, что показать).
// БД и Telegram не знает; заявку по ответу `submit` создаёт вызывающий.
import {
  availableDates,
  availableHours,
  availablePeriods,
  type BookingEnv,
  PERIOD_IDS,
  type PeriodId,
  todayIn,
  validateSlot,
} from "./bookingRules.ts";
import {
  looksLikeName,
  splitNameAndContact,
  validateComment,
  validateContact,
  validateGuests,
  validateName,
} from "./fieldValidation.ts";
import {
  type AdvanceResult,
  type BookingChange,
  type BookingData,
  type BookingState,
  type BookingStep,
  type FlowEnv,
  type FlowErrorCode,
  type FlowInput,
  type FlowScreen,
} from "./flowState.ts";
import { startGuestRequest } from "./guestRequestFlow.ts";
import { buildBookingSummary } from "./requestSummaries.ts";

function bookingEnv(env: FlowEnv): BookingEnv {
  return { now: env.now, timeZone: env.timeZone, openingHours: env.openingHours };
}

/** Экран текущего шага. Экспортируется для черновика от агента (bookingDraft.ts): он ставит шаг сам. */
export function bookingScreen(state: BookingState, env: FlowEnv): FlowScreen {
  const { data } = state;
  const be = bookingEnv(env);
  switch (state.step) {
    case "date": {
      const dates = availableDates(be);
      return dates.length === 0 ? { screen: "no_dates" } : { screen: "ask_date", dates, today: todayIn(be) };
    }
    case "period":
      return { screen: "ask_period", date: data.date!, periods: availablePeriods(data.date!, be) };
    case "hour":
      return { screen: "ask_hour", date: data.date!, period: data.period!, hours: availableHours(data.date!, data.period!, be) };
    case "guests":
      return { screen: "ask_guests", keepGuests: state.change?.guests };
    case "name":
      return { screen: "ask_name", withContact: !data.contact, telegram: data.contact ? null : telegramFill(env) };
    case "contact":
      return { screen: "ask_contact", canUseUsername: env.username !== null, optional: false };
    case "confirm":
      return {
        screen: "confirm",
        flow: "booking",
        summary: buildBookingSummary(data),
        isChange: !!state.change,
        // Пожелания дописываются на сводке; при изменении брони комментарий берётся из исходной и не меняется.
        askMore: !state.change,
      };
  }
}

/**
 * Что даёт кнопка «Использовать Telegram»: @username как контакт и имя из профиля, если оно похоже на имя
 * (в профиле бывают эмодзи и ники — тогда только контакт, имя гость напишет сам). null — @username нет.
 */
export function telegramFill(env: FlowEnv): { name: string | null; username: string } | null {
  if (!env.username || !validateContact(`@${env.username}`).ok) return null;
  const name = env.firstName ? validateName(env.firstName) : null;
  return { name: name?.ok && looksLikeName(name.value) ? name.value : null, username: env.username };
}

/** Данные, без которых шаг не имеет смысла (битое состояние в БД), — начинаем сценарий заново. */
function isConsistent(state: BookingState): boolean {
  const d = state.data;
  const needs: Record<BookingStep, boolean> = {
    date: true,
    period: !!d.date,
    hour: !!d.date && !!d.period,
    guests: !!d.date && !!d.time,
    name: !!d.date && !!d.time && d.guests !== undefined,
    contact: !!d.date && !!d.time && d.guests !== undefined && !!d.name,
    confirm: !!d.date && !!d.time && d.guests !== undefined && !!d.name && !!d.contact,
  };
  return needs[state.step];
}

/** Порядок шагов и поля, которые каждый шаг заполняет: по ним «Назад» стирает данные шага и всех следующих. */
const STEP_ORDER: BookingStep[] = ["date", "period", "hour", "guests", "name", "contact", "confirm"];
/** При изменении брони имя, контакт и комментарий не спрашиваем. */
const CHANGE_STEP_ORDER: BookingStep[] = ["date", "period", "hour", "guests", "confirm"];
const STEP_FIELDS: Partial<Record<BookingStep, (keyof BookingData)[]>> = {
  date: ["date"],
  period: ["period"],
  hour: ["time"],
  guests: ["guests"],
  name: ["name"],
  contact: ["contact"],
};

/**
 * Первый шаг, данных которого ещё нет. Шаги идут не строго по одному: имя приходит вместе с контактом, агент
 * заполняет сразу несколько полей (bookingDraft.ts) — тогда уже заполненные шаги пропускаются.
 */
export function firstMissingStep(state: BookingState): BookingStep {
  const order = state.change ? CHANGE_STEP_ORDER : STEP_ORDER;
  return order.find((s) => (STEP_FIELDS[s] ?? []).some((f) => state.data[f] === undefined)) ?? "confirm";
}

/** Шаг назад: данные текущего и предыдущего шагов стираются, гость вводит их заново. null — назад некуда. */
function goBack(state: BookingState): BookingState | null {
  const order = state.change ? CHANGE_STEP_ORDER : STEP_ORDER;
  const prevIndex = order.indexOf(state.step) - 1;
  if (prevIndex < 0) return null;
  const step = order[prevIndex];
  const data = { ...state.data };
  // Стираем поля шага, на который вернулись, и всех после него.
  for (const s of order.slice(prevIndex)) {
    for (const field of STEP_FIELDS[s] ?? []) delete data[field];
  }
  return { ...state, step, data };
}

/** Новая бронь; с `change` — изменение существующей: имя, контакт и комментарий уже известны. */
export function startBooking(env: FlowEnv, change?: BookingChange): AdvanceResult {
  const state: BookingState = {
    flow: "booking",
    step: "date",
    draftId: env.newDraftId(),
    data: change ? { name: change.name, contact: change.contact, comment: change.comment } : {},
    touchedAt: env.now.toISOString(),
    ...(change ? { change } : {}),
  };
  return { state, reply: { screen: bookingScreen(state, env) } };
}

/**
 * Пока гость выбирал, время шло: слот на выбранную дату/период мог исчезнуть (сегодня стало слишком поздно).
 * Откатываем на шаг, где выбор снова возможен. null — всё в порядке.
 */
/** Данные, которые сценарий изменения знает с самого начала. */
function prefilled(state: BookingState): BookingData {
  const c = state.change;
  return c ? { name: c.name, contact: c.contact, comment: c.comment } : {};
}

function rollbackIfSlotGone(state: BookingState, env: FlowEnv): BookingState | null {
  const be = bookingEnv(env);
  const { date, period } = state.data;
  if ((state.step === "period" || state.step === "hour") && availablePeriods(date!, be).length === 0) {
    return { ...state, step: "date", data: prefilled(state) };
  }
  if (state.step === "hour" && availableHours(date!, period!, be).length === 0) {
    return { ...state, step: "period", data: { ...prefilled(state), date } };
  }
  return null;
}

export function advanceBooking(state: BookingState, input: FlowInput, env: FlowEnv): AdvanceResult {
  if (input.type === "action" && input.action === "restart") return startBooking(env, state.change);
  if (!isConsistent(state)) return startBooking(env, state.change);

  const touched: BookingState = { ...state, touchedAt: env.now.toISOString() };
  const stay = (error: FlowErrorCode): AdvanceResult => ({
    state: touched,
    reply: { screen: bookingScreen(touched, env), error },
  });
  const next = (step: BookingStep, patch: Partial<BookingData>): AdvanceResult => {
    const moved: BookingState = { ...touched, step, data: { ...touched.data, ...patch } };
    return { state: moved, reply: { screen: bookingScreen(moved, env) } };
  };
  /** Записать поля и перейти к первому шагу, которого ещё нет (заполненные раньше пропускаются). */
  const forward = (patch: Partial<BookingData>): AdvanceResult => {
    const filled: BookingState = { ...touched, data: { ...touched.data, ...patch } };
    const moved: BookingState = { ...filled, step: firstMissingStep(filled) };
    return { state: moved, reply: { screen: bookingScreen(moved, env) } };
  };

  if (input.type === "action" && input.action === "back") {
    const prev = goBack(touched);
    if (!prev) return stay("unavailable");
    return { state: prev, reply: { screen: bookingScreen(prev, env) } };
  }

  const rolled = rollbackIfSlotGone(touched, env);
  if (rolled) return { state: rolled, reply: { screen: bookingScreen(rolled, env), error: "unavailable" } };

  const be = bookingEnv(env);
  switch (state.step) {
    case "date": {
      if (input.type === "text") return stay("use_buttons");
      const date = /^d=(\d{4}-\d{2}-\d{2})$/.exec(input.action)?.[1];
      return date && availableDates(be).includes(date) ? next("period", { date }) : stay("unavailable");
    }
    case "period": {
      if (input.type === "text") return stay("use_buttons");
      const period = /^p=(\w+)$/.exec(input.action)?.[1] as PeriodId | undefined;
      const ok = period && PERIOD_IDS.includes(period) && availablePeriods(state.data.date!, be).includes(period);
      return ok ? next("hour", { period }) : stay("unavailable");
    }
    case "hour": {
      // Текстовый ввод времени не принимаем (спека): только кнопки, так не бывает «19:30» и «вечером».
      if (input.type === "text") return stay("use_buttons");
      const hour = /^h=(\d{1,2})$/.exec(input.action)?.[1];
      if (!hour) return stay("unavailable");
      const time = `${hour.padStart(2, "0")}:00`;
      const slot = validateSlot(state.data.date!, time, be);
      const inPeriod = availableHours(state.data.date!, state.data.period!, be).includes(Number(hour));
      return slot.ok && inPeriod ? next("guests", { time }) : stay("unavailable");
    }
    case "guests": {
      if (input.type === "action") {
        // «Оставить N» — только в режиме изменения.
        if (input.action === "keep" && state.change) return next("confirm", { guests: state.change.guests });
        // Больше 20 гостей — не к боту, а к менеджеру: переключаем в сценарий обращения.
        return input.action === "to_manager" ? startGuestRequest(env, "manager_request") : stay("unavailable");
      }
      const v = validateGuests(input.text);
      if (v.ok) return forward({ guests: v.value });
      // Состояние то же, но экран другой: предлагаем кнопку перехода к менеджеру.
      if (v.error === "guests_too_many") return { state: touched, reply: { screen: { screen: "too_many_guests" } } };
      return stay(v.error);
    }
    case "name": {
      if (input.type === "action") {
        // «Использовать Telegram»: @username — контакт, имя из профиля, если годится (иначе останется шаг имени).
        const tg = input.action === "tg" && !state.data.contact ? telegramFill(env) : null;
        if (!tg) return stay("use_buttons");
        return forward({ contact: `@${tg.username}`, ...(tg.name ? { name: tg.name } : {}) });
      }
      const v = validateName(input.text);
      if (v.ok && looksLikeName(v.value)) return forward({ name: v.value });
      // Имя и контакт одним сообщением («Анна +30 690…»): разбираем без LLM.
      const both = state.data.contact ? null : splitNameAndContact(input.text);
      if (both) return forward({ contact: both.contact, ...(both.name ? { name: both.name } : {}) });
      // Вопрос или фраза вместо имени не принимается: при включённом AI её разберёт агент (S09).
      return stay(v.ok ? "name_unlikely" : v.error);
    }
    case "contact": {
      if (input.type === "action") {
        if (input.action !== "me" || !env.username) return stay("unavailable");
        const v = validateContact(`@${env.username}`);
        return v.ok ? forward({ contact: v.value }) : stay(v.error);
      }
      const v = validateContact(input.text);
      return v.ok ? forward({ contact: v.value }) : stay(v.error);
    }
    case "confirm": {
      if (input.type === "text") {
        // «Что-нибудь ещё?» на сводке: текст — пожелание, дописывается к уже указанному. Вопрос пожеланием не
        // считается: при включённом AI на него ответит агент (S09). При изменении брони комментарий не меняется.
        if (state.change) return stay("use_buttons");
        if (/[?¿？]/.test(input.text)) return stay("comment_unlikely");
        const added = input.text.trim();
        if (!added) return stay("text_empty");
        const v = validateComment(state.data.comment ? `${state.data.comment}; ${added}` : added);
        return v.ok ? next("confirm", { comment: v.value }) : stay(v.error);
      }
      if (input.action !== "send") return stay("unavailable");
      // Состояние не меняем: если создание заявки упадёт, гость нажмёт «Отправить» ещё раз.
      return { state: touched, reply: { screen: { screen: "submit" } } };
    }
  }
}
