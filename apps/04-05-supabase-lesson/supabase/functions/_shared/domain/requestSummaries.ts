// Тексты-сводки заявок: гостю перед отправкой и менеджеру в уведомлении. Чистые форматтеры.
// Подписи полей («Дата», «Гостей») — часть форматтера, как в карточке блюда (ADR-009).
import type { BookingData, GuestRequestData, GuestRequestKind } from "./flowState.ts";
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
export function buildBookingSummary(data: BookingData): string {
  return [
    `📅 Дата: ${data.date ? formatDate(data.date) : NO_COMMENT}`,
    `🕒 Время: ${data.time ?? NO_COMMENT}`,
    `👥 Гостей: ${data.guests ?? NO_COMMENT}`,
    `👤 Имя: ${data.name ?? NO_COMMENT}`,
    `📞 Контакт: ${data.contact ?? NO_COMMENT}`,
    `💬 Комментарий: ${data.comment ?? NO_COMMENT}`,
  ].join("\n");
}

export function buildGuestRequestSummary(data: GuestRequestData): string {
  return [
    `Тип: ${data.kind ? GUEST_REQUEST_KIND_LABEL[data.kind] : NO_COMMENT}`,
    `💬 Текст: ${data.text ?? NO_COMMENT}`,
    `📞 Контакт: ${data.contact ?? "не указан"}`,
  ].join("\n");
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

export function formatBookingNotification(r: BookingNotificationInput, timeZone: string): string {
  return [
    "📅 Новая заявка на бронь (ожидает подтверждения)",
    "",
    `Когда: ${formatLocalDateTime(new Date(r.booking_at), timeZone)}`,
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
