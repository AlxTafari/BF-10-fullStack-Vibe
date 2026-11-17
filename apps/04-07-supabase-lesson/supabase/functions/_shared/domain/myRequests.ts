// «Мои заявки»: что показать гостю о его заявках и что с ними можно делать. Чистые функции.
import { formatDate, GUEST_REQUEST_KIND_LABEL } from "./requestSummaries.ts";
import type { GuestRequestKind } from "./flowState.ts";
import { formatLocalDateTime } from "./zonedTime.ts";

export type BookingStatus = "pending" | "confirmed" | "declined" | "cancelled";
export type GuestRequestStatus = "new" | "in_progress" | "resolved";

// Статус говорит ровно то, что есть: «ожидает подтверждения» — не «забронировано» (инвариант спринта).
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "ожидает подтверждения",
  confirmed: "подтверждена менеджером",
  declined: "отклонена",
  cancelled: "отменена",
};

export const GUEST_REQUEST_STATUS_LABEL: Record<GuestRequestStatus, string> = {
  new: "получено",
  in_progress: "в работе",
  resolved: "обработано",
};

export interface MyBooking {
  id: string;
  guest_name: string;
  contact: string;
  booking_at: string;
  guests_count: number;
  comment: string | null;
  status: BookingStatus;
  replaces_id: string | null;
}

/** Заявку можно отменять/менять, пока она живая и в будущем. */
export function isBookingActive(b: Pick<MyBooking, "status" | "booking_at">, now: Date): boolean {
  return (b.status === "pending" || b.status === "confirmed") && new Date(b.booking_at).getTime() > now.getTime();
}

/** Отменить можно любую живую заявку (в том числе заявку-изменение). */
export function canCancelBooking(b: MyBooking, now: Date): boolean {
  return isBookingActive(b, now);
}

/** Изменить можно живую бронь, которая сама не является изменением и у которой нет ожидающего изменения. */
export function canChangeBooking(b: MyBooking, hasPendingChange: boolean, now: Date): boolean {
  return isBookingActive(b, now) && b.replaces_id === null && !hasPendingChange;
}

/** "вт, 20.10 19:00 · 4 гост." — подпись кнопки и строка списка. */
export function formatBookingShort(b: MyBooking, timeZone: string): string {
  const local = formatLocalDateTime(new Date(b.booking_at), timeZone); // 20.10.2026 19:00
  const [date, time] = local.split(" ");
  const [d, m, y] = date.split(".");
  const dayLabel = formatDate(`${y}-${m}-${d}`).slice(0, -5); // «вт, 20.10»
  const change = b.replaces_id ? "✏️ " : "";
  return `${change}${dayLabel} ${time} · ${b.guests_count} гост. · ${BOOKING_STATUS_LABEL[b.status]}`;
}

export function formatBookingCard(b: MyBooking, timeZone: string, pendingChange: MyBooking | null): string {
  const title = b.replaces_id ? "✏️ Запрос на изменение брони" : "📅 Заявка на бронь";
  const lines = [
    title,
    "",
    `Когда: ${formatLocalDateTime(new Date(b.booking_at), timeZone)}`,
    `Гостей: ${b.guests_count}`,
    `Имя: ${b.guest_name}`,
    `Контакт: ${b.contact}`,
    `Комментарий: ${b.comment ?? "—"}`,
    "",
    `Статус: ${BOOKING_STATUS_LABEL[b.status]}`,
  ];
  if (pendingChange) {
    lines.push(
      "",
      `✏️ Запрошено изменение: ${formatLocalDateTime(new Date(pendingChange.booking_at), timeZone)}, гостей: ${pendingChange.guests_count} — ${BOOKING_STATUS_LABEL[pendingChange.status]}. Пока менеджер не подтвердит, действует эта бронь.`,
    );
  }
  return lines.join("\n");
}

export interface MyGuestRequest {
  kind: GuestRequestKind;
  text: string;
  status: GuestRequestStatus;
}

const TEXT_PREVIEW = 50;

export function formatGuestRequestLine(r: MyGuestRequest): string {
  const text = r.text.length > TEXT_PREVIEW ? `${r.text.slice(0, TEXT_PREVIEW).trimEnd()}…` : r.text;
  return `• ${GUEST_REQUEST_KIND_LABEL[r.kind]}: «${text}» — ${GUEST_REQUEST_STATUS_LABEL[r.status]}`;
}
