// Тексты гостю о решении ресторана по брони (notify-guest). Чистые форматтеры, как requestSummaries.
// Не обещают лишнего: «подтверждена» — только когда менеджер подтвердил; про отказ — без причин (их мы не знаем).
import { formatLocalDateTime } from "./zonedTime.ts";

export interface BookingDecisionInput {
  status: "pending" | "confirmed" | "declined" | "cancelled";
  booking_at: string;
  guests_count: number;
  /** Заявка — запрос на изменение существующей брони (replaces_id задан). */
  isChange: boolean;
}

/** Решение, о котором гостю стоит сообщить. pending — не решение. */
export function isBookingDecision(status: string): status is "confirmed" | "declined" | "cancelled" {
  return status === "confirmed" || status === "declined" || status === "cancelled";
}

/**
 * Время брони уже наступило. О решении по такой заявке гостю не пишем: он сам знает, что время прошло,
 * а «не можем принять заявку на 14.10 01:21» спустя часы или дни — шум.
 */
export function isBookingPast(bookingAt: string, now: Date): boolean {
  return new Date(bookingAt).getTime() <= now.getTime();
}

/** Текст гостю или null, если по этому статусу сообщать нечего. */
export function formatBookingDecision(b: BookingDecisionInput, timeZone: string): string | null {
  if (!isBookingDecision(b.status)) return null;

  const details = [
    `📅 Когда: ${formatLocalDateTime(new Date(b.booking_at), timeZone)}`,
    `👥 Гостей: ${b.guests_count}`,
  ];

  switch (b.status) {
    case "confirmed":
      return b.isChange
        ? ["✅ Изменение брони подтверждено", "", ...details, "", "Прежняя бронь отменена."].join("\n")
        : ["✅ Ваша бронь подтверждена", "", ...details, "", "Ждём вас!"].join("\n");
    case "declined":
      return b.isChange
        ? ["Ресторан не смог принять изменение брони", "", ...details, "", "Прежняя бронь остаётся в силе."].join("\n")
        : [
          "К сожалению, ресторан не может принять вашу заявку на бронь",
          "",
          ...details,
          "",
          "Можно отправить новую заявку на другое время.",
        ].join("\n");
    case "cancelled":
      return b.isChange
        ? ["❌ Ресторан отменил запрос на изменение брони", "", ...details, "", "Прежняя бронь остаётся в силе."].join("\n")
        : ["❌ Ресторан отменил вашу заявку на бронь", "", ...details, "", "Можно отправить новую заявку или написать нам."].join("\n");
  }
}
