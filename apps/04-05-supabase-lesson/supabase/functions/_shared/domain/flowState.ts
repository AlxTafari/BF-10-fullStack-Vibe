// Состояние пошагового сценария (бронь, обращение). Живёт в conversations.state (jsonb); {} = сценария нет.
import type { FieldError } from "./fieldValidation.ts";
import type { OpeningHours, PeriodId, SlotError } from "./bookingRules.ts";

/** Брошенный сценарий через столько перестаёт быть живым: «привет» не принимается за имя. */
export const FLOW_TTL_MS = 30 * 60 * 1000;

/**
 * Шагов «комментарий» нет: пожелание гость пишет на карточке-сводке («Что-нибудь ещё?») или сразу в первой фразе
 * агенту (S09, сессия 3).
 */
/** edit — меню «Что исправить?» с карточки-сводки (S09): шаг, чтобы текст гостя на нём не ушёл в пожелания. */
export type BookingStep = "date" | "period" | "hour" | "guests" | "name" | "contact" | "confirm" | "edit";
export type GuestRequestStep = "kind" | "text" | "contact" | "confirm" | "edit";

/** Что можно исправить из меню «Что исправить?». Пожелания — только в новой брони (при изменении берутся из исходной). */
export type BookingEditField = "date" | "time" | "guests" | "name" | "contact" | "comment";
export type GuestRequestEditField = "kind" | "text" | "contact";
export type GuestRequestKind = "feedback" | "complaint" | "manager_request";

export const GUEST_REQUEST_KINDS: GuestRequestKind[] = ["feedback", "complaint", "manager_request"];

export interface BookingData {
  date?: string;
  period?: PeriodId;
  time?: string;
  guests?: number;
  name?: string;
  contact?: string;
  /** Пожелания. undefined или null — нет (null — у черновиков до S09 и при изменении брони без комментария). */
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

/** Изменение существующей брони: сценарий начинается с её данных. Снимок неизменен — «Начать заново» возвращается к нему. */
export interface BookingChange {
  replacesId: string;
  guests: number;
  name: string;
  contact: string;
  comment: string | null;
}

export interface BookingState extends FlowBase {
  flow: "booking";
  step: BookingStep;
  data: BookingData;
  /** Есть только у сценария «изменить бронь»: имя, контакт и комментарий не спрашиваем, берём из исходной. */
  change?: BookingChange;
  /**
   * Идёт исправление пункта с карточки (S09): данные до него. «Назад» возвращает их и карточку — гость, передумавший
   * на полпути, ничего не теряет. Снимается, когда сценарий снова дошёл до карточки.
   */
  editFrom?: BookingData;
}

export interface GuestRequestState extends FlowBase {
  flow: "guest_request";
  step: GuestRequestStep;
  data: GuestRequestData;
  /** Как у брони: данные до исправления пункта с карточки. */
  editFrom?: GuestRequestData;
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
  /** Имя из профиля Telegram — для кнопки «Использовать Telegram» на шаге имени. */
  firstName: string | null;
  /** Генератор draftId — в тестах подменяется. */
  newDraftId: () => string;
}

/** correction_unclear — агент не разобрал текст на карточке (S09): карточка та же, подсказка про «Исправить». */
export type FlowErrorCode = FieldError | SlotError | "use_buttons" | "unavailable" | "contact_required" | "correction_unclear";

/** Что показать гостю: ключ экрана и данные. Тексты и клавиатуры собирает content.ts. */
/**
 * editing — идёт исправление пункта с карточки: на первых шагах (дата, тип обращения), где «Назад» обычно нет,
 * он нужен — вернуться к карточке без изменений.
 */
export type FlowScreen =
  | { screen: "ask_date"; dates: string[]; today: string; editing?: boolean }
  | { screen: "no_dates" }
  | { screen: "ask_period"; date: string; periods: PeriodId[] }
  | { screen: "ask_hour"; date: string; period: PeriodId; hours: number[] }
  /** keepGuests — в режиме изменения: кнопка «Оставить N». */
  | { screen: "ask_guests"; keepGuests?: number }
  | { screen: "too_many_guests" }
  /**
   * withContact — контакта ещё нет: можно написать имя вместе с телефоном. telegram — кнопка «Использовать Telegram»:
   * имя из профиля (если годится) и @username одним нажатием.
   */
  | { screen: "ask_name"; withContact: boolean; telegram: { name: string | null; username: string } | null }
  | { screen: "ask_contact"; canUseUsername: boolean; optional: boolean }
  | { screen: "ask_kind"; editing?: boolean }
  | { screen: "ask_text"; kind: GuestRequestKind }
  /** askMore — бронь: под сводкой «Что-нибудь ещё?», текст гостя дописывается в пожелания. */
  | { screen: "confirm"; flow: FlowState["flow"]; summary: string; isChange?: boolean; askMore?: boolean }
  /** «✏️ Исправить» на карточке: какие пункты можно поменять (S09). */
  | { screen: "edit_menu"; flow: FlowState["flow"]; fields: (BookingEditField | GuestRequestEditField)[] }
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

// ---------------------------------------------------------------- черновик от агента (S09)

/**
 * Почему поле от агента не принято. Сверх ошибок ручного ввода: время без даты, поле, которое в этом сценарии
 * не меняется (имя и контакт при изменении брони), неизвестный тип обращения; useTelegram, а @username у гостя нет
 * (no_telegram_username); шаблон вместо настоящего ника — «@username» (contact_placeholder, см. agentContact.ts).
 */
export type DraftError = FlowErrorCode | "needs_date" | "not_editable" | "bad_kind" | "no_telegram_username" | "contact_placeholder";

/**
 * Итог применения полей от агента к черновику. result — тот же AdvanceResult, что у кнопочного шага:
 * дальше черновик живёт в обычном сценарии. accepted/errors/missing — ответ модели, что спросить у гостя.
 */
export interface DraftOutcome<F extends string> {
  result: AdvanceResult;
  accepted: F[];
  errors: Partial<Record<F, DraftError>>;
  missing: F[];
}

// ---------------------------------------------------------------- разбор из jsonb

const BOOKING_STEPS: BookingStep[] = ["date", "period", "hour", "guests", "name", "contact", "confirm", "edit"];
const GUEST_STEPS: GuestRequestStep[] = ["kind", "text", "contact", "confirm", "edit"];

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
