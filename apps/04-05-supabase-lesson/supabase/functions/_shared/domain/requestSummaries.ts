// Тексты-сводки заявок: гостю перед отправкой и менеджеру в уведомлении. Чистые форматтеры.
// Подписи полей («Дата», «Гостей») — часть форматтера, как в карточке блюда (ADR-009).
import type { BookingData, BookingEditField, GuestRequestData, GuestRequestEditField, GuestRequestKind } from "./flowState.ts";
import { formatLocalDateTime, isoWeekday } from "./zonedTime.ts";

export const GUEST_REQUEST_KIND_LABEL: Record<GuestRequestKind, string> = {
  feedback: "Отзыв",
  complaint: "Жалоба",
  manager_request: "Вопрос менеджеру",
};

const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const NO_COMMENT = "—";

/** "2026-10-20" → "вт, 20.10.2026". */
export function formatDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${WEEKDAY_SHORT[isoWeekday(date) - 1]}, ${d}.${m}.${y}`;
}

/** Сводка брони для подтверждения гостем. Пока гость не нажал «Отправить», это только заявка, не бронь. */
/** Пометка пункта, изменённого исправлением (S09): гость видит, что именно поменялось, до того как отправить. */
const CHANGED_MARK = " ✏️";
const mark = (changed: readonly string[], field: string) => (changed.includes(field) ? CHANGED_MARK : "");

/** changed — пункты, изменённые последним исправлением (кнопкой или поправкой агенту); помечаются ✏️. */
export function buildBookingSummary(data: BookingData, changed: readonly BookingEditField[] = []): string {
  return [
    `📅 Дата: ${data.date ? formatDate(data.date) : NO_COMMENT}${mark(changed, "date")}`,
    `🕒 Время: ${data.time ?? NO_COMMENT}${mark(changed, "time")}`,
    `👥 Гостей: ${data.guests ?? NO_COMMENT}${mark(changed, "guests")}`,
    `👤 Имя: ${data.name ?? NO_COMMENT}${mark(changed, "name")}`,
    `📞 Контакт: ${data.contact ?? NO_COMMENT}${mark(changed, "contact")}`,
    `💬 Пожелания: ${data.comment ?? NO_COMMENT}${mark(changed, "comment")}`,
  ].join("\n");
}

export function buildGuestRequestSummary(data: GuestRequestData, changed: readonly GuestRequestEditField[] = []): string {
  return [
    `Тип: ${data.kind ? GUEST_REQUEST_KIND_LABEL[data.kind] : NO_COMMENT}${mark(changed, "kind")}`,
    `💬 Текст: ${data.text ?? NO_COMMENT}${mark(changed, "text")}`,
    `📞 Контакт: ${data.contact ?? "не указан"}${mark(changed, "contact")}`,
  ].join("\n");
}

/** Какие пункты брони отличаются (для пометки ✏️). Период не пункт карточки: он следует из времени. */
export function changedBookingFields(before: BookingData, after: BookingData): BookingEditField[] {
  const fields: BookingEditField[] = ["date", "time", "guests", "name", "contact", "comment"];
  // undefined и null у пожеланий — одно и то же «нет».
  return fields.filter((f) => (before[f] ?? null) !== (after[f] ?? null));
}

export function changedGuestRequestFields(before: GuestRequestData, after: GuestRequestData): GuestRequestEditField[] {
  const fields: GuestRequestEditField[] = ["kind", "text", "contact"];
  return fields.filter((f) => (before[f] ?? null) !== (after[f] ?? null));
}

// ---------------------------------------------------------------- уведомления менеджеру

export interface BookingNotificationInput {
  id: string;
  guest_name: string;
  contact: string;
  booking_at: string;
  guests_count: number;
  comment: string | null;
  created_at: string;
}

export interface GuestRequestNotificationInput {
  id: string;
  kind: GuestRequestKind;
  text: string;
  contact: string | null;
  created_at: string;
}

/** Исходная бронь, которую гость просит изменить (для строки «Было»). */
export interface ReplacedBookingInfo {
  booking_at: string;
  guests_count: number;
}

export function formatBookingNotification(
  r: BookingNotificationInput,
  timeZone: string,
  replaces?: ReplacedBookingInfo | null,
): string {
  const header = replaces
    ? "✏️ Запрос на изменение брони (ожидает подтверждения; пока не подтверждено, действует прежняя бронь)"
    : "📅 Новая заявка на бронь (ожидает подтверждения)";
  const was = replaces
    ? [`Было: ${formatLocalDateTime(new Date(replaces.booking_at), timeZone)}, гостей: ${replaces.guests_count}`]
    : [];
  return [
    header,
    "",
    ...was,
    `${replaces ? "Станет" : "Когда"}: ${formatLocalDateTime(new Date(r.booking_at), timeZone)}`,
    `Гостей: ${r.guests_count}`,
    `Имя: ${r.guest_name}`,
    `Контакт: ${r.contact}`,
    `Комментарий: ${r.comment ?? NO_COMMENT}`,
    "",
    `Создана: ${formatLocalDateTime(new Date(r.created_at), timeZone)}`,
    `ID: ${r.id}`,
  ].join("\n");
}

export function formatGuestRequestNotification(r: GuestRequestNotificationInput, timeZone: string): string {
  return [
    `💬 Новое обращение: ${GUEST_REQUEST_KIND_LABEL[r.kind]}`,
    "",
    r.text,
    "",
    `Контакт: ${r.contact ?? "не указан"}`,
    `Создано: ${formatLocalDateTime(new Date(r.created_at), timeZone)}`,
    `ID: ${r.id}`,
  ].join("\n");
}

/** Гость отменил бронь (или запрос на изменение). */
export function formatBookingCancelledNotification(
  r: BookingNotificationInput & { replaces_id: string | null },
  timeZone: string,
  alsoCancelledChange: boolean,
): string {
  return [
    r.replaces_id ? "❌ Гость отменил запрос на изменение брони (прежняя бронь остаётся в силе)" : "❌ Гость отменил бронь",
    "",
    `Когда: ${formatLocalDateTime(new Date(r.booking_at), timeZone)}`,
    `Гостей: ${r.guests_count}`,
    `Имя: ${r.guest_name}`,
    `Контакт: ${r.contact}`,
    ...(alsoCancelledChange ? ["", "Ожидавший изменение запрос тоже отменён."] : []),
    "",
    `ID: ${r.id}`,
  ].join("\n");
}
