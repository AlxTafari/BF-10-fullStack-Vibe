// Состояние пошагового сценария (бронь, обращение). Живёт в conversations.state (jsonb); {} = сценария нет.
import type { FieldError } from "./fieldValidation.ts";
import type { OpeningHours, PeriodId, SlotError } from "./bookingRules.ts";

/** Брошенный сценарий через столько перестаёт быть живым: «привет» не принимается за имя. */
export const FLOW_TTL_MS = 30 * 60 * 1000;

export type BookingStep = "date" | "period" | "hour" | "guests" | "name" | "contact" | "comment" | "confirm";
export type GuestRequestStep = "kind" | "text" | "contact" | "confirm";
export type GuestRequestKind = "feedback" | "complaint" | "manager_request";

export const GUEST_REQUEST_KINDS: GuestRequestKind[] = ["feedback", "complaint", "manager_request"];

export interface BookingData {
  date?: string;
  period?: PeriodId;
  time?: string;
  guests?: number;
  name?: string;
  contact?: string;
  /** undefined = шаг ещё не пройден, null = гость пропустил. */
  comment?: string | null;
}

export interface GuestRequestData {
  kind?: GuestRequestKind;
  text?: string;
  /** undefined = шаг ещё не пройден, null = гость пропустил. */
  contact?: string | null;
}

interface FlowBase {
  /** Создаётся при старте сценария; идёт в idempotency_key и в callback_data кнопок. */
  draftId: string;
  /** ISO-время последнего действия — для истечения. */
  touchedAt: string;
}

export interface BookingState extends FlowBase {
  flow: "booking";
  step: BookingStep;
  data: BookingData;
}

export interface GuestRequestState extends FlowBase {
  flow: "guest_request";
  step: GuestRequestStep;
  data: GuestRequestData;
}

export type FlowState = BookingState | GuestRequestState;

// ---------------------------------------------------------------- вход / выход advance

export type FlowInput = { type: "text"; text: string } | { type: "action"; action: string };

/** Всё внешнее, что нужно сценарию; чистой функции его передают снаружи. */
export interface FlowEnv {
  now: Date;
  timeZone: string;
  openingHours: OpeningHours | null;
  /** @username гостя из текущего апдейта (без @), если он у него есть. */
  username: string | null;
  /** Генератор draftId — в тестах подменяется. */
  newDraftId: () => string;
}

export type FlowErrorCode = FieldError | SlotError | "use_buttons" | "unavailable" | "contact_required";

/** Что показать гостю: ключ экрана и данные. Тексты и клавиатуры собирает content.ts. */
export type FlowScreen =
  | { screen: "ask_date"; dates: string[]; today: string }
  | { screen: "no_dates" }
  | { screen: "ask_period"; date: string; periods: PeriodId[] }
  | { screen: "ask_hour"; date: string; period: PeriodId; hours: number[] }
  | { screen: "ask_guests" }
  | { screen: "too_many_guests" }
  | { screen: "ask_name" }
  | { screen: "ask_contact"; canUseUsername: boolean; optional: boolean }
  | { screen: "ask_comment" }
  | { screen: "ask_kind" }
  | { screen: "ask_text"; kind: GuestRequestKind }
  | { screen: "confirm"; flow: FlowState["flow"]; summary: string }
  /** Гость подтвердил: вызывающий создаёт заявку из state.data. Состояние не меняется. */
  | { screen: "submit" };

export interface FlowReply {
  screen: FlowScreen;
  /** Если ввод не прошёл — экран тот же, плюс причина. */
  error?: FlowErrorCode;
}

export interface AdvanceResult {
  state: FlowState;
  reply: FlowReply;
}

// ---------------------------------------------------------------- разбор из jsonb

const BOOKING_STEPS: BookingStep[] = ["date", "period", "hour", "guests", "name", "contact", "comment", "confirm"];
const GUEST_STEPS: GuestRequestStep[] = ["kind", "text", "contact", "confirm"];

/**
 * jsonb из БД → состояние. null — сценария нет: пустой объект, битые данные или сценарий истёк.
 * Проверяем форму, а не верим базе: состояние пишет код, но формат за спринты меняется.
 */
export function parseFlowState(raw: unknown, now: Date): FlowState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.draftId !== "string" || typeof s.touchedAt !== "string") return null;
  if (typeof s.data !== "object" || s.data === null) return null;

  const touched = Date.parse(s.touchedAt);
  if (Number.isNaN(touched) || now.getTime() - touched > FLOW_TTL_MS) return null;

  if (s.flow === "booking" && BOOKING_STEPS.includes(s.step as BookingStep)) return s as unknown as BookingState;
  if (s.flow === "guest_request" && GUEST_STEPS.includes(s.step as GuestRequestStep)) {
    return s as unknown as GuestRequestState;
  }
  return null;
}
