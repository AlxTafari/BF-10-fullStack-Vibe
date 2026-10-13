import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  formatBookingCancelledNotification,
  formatBookingNotification,
  formatGuestRequestNotification,
} from "../domain/requestSummaries.ts";
import { findBookingById, markBookingNotified } from "../repositories/bookingRequestsRepo.ts";
import { markGuestRequestNotified } from "../repositories/guestRequestsRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { BookingRequestRow, GuestRequestRow } from "../types.ts";

/** Отправка текста в чат. Сервис не знает про Telegram (ADR-008): функцию даёт обработчик. */
export type SendText = (chatId: number, text: string) => Promise<void>;

export type ManagerNotification =
  | { kind: "booking"; request: BookingRequestRow }
  /** Гость отменил бронь или запрос на изменение. manager_notified_at не трогаем: он про создание заявки. */
  | { kind: "booking_cancelled"; request: BookingRequestRow; alsoCancelledChange: boolean }
  | { kind: "guest_request"; request: GuestRequestRow };

export type NotifyResult = "sent" | "disabled" | "failed";

/**
 * Уведомляет менеджера о новой заявке и ставит manager_notified_at. Вызывать только если `created === true`:
 * повторная обработка той же заявки не должна слать второе уведомление.
 * Ошибка отправки не пробрасывается — заявка уже сохранена, гость не должен видеть «не удалось».
 */
export async function notifyManager(
  client: SupabaseClient,
  send: SendText,
  notification: ManagerNotification,
): Promise<NotifyResult> {
  try {
    const restaurant = await getRestaurant(client);
    if (!restaurant?.manager_chat_id) {
      console.warn(`manager_chat_id не задан — уведомление о заявке ${notification.request.id} не отправлено`);
      return "disabled";
    }

    let text: string;
    switch (notification.kind) {
      case "booking": {
        // Для запроса на изменение менеджеру нужно видеть, что было.
        const { replaces_id } = notification.request;
        const original = replaces_id ? await findBookingById(client, replaces_id) : null;
        text = formatBookingNotification(notification.request, restaurant.timezone, original);
        break;
      }
      case "booking_cancelled":
        text = formatBookingCancelledNotification(notification.request, restaurant.timezone, notification.alsoCancelledChange);
        break;
      case "guest_request":
        text = formatGuestRequestNotification(notification.request, restaurant.timezone);
        break;
    }
    await send(restaurant.manager_chat_id, text);

    if (notification.kind === "booking") await markBookingNotified(client, notification.request.id);
    else if (notification.kind === "guest_request") await markGuestRequestNotified(client, notification.request.id);
    return "sent";
  } catch (error) {
    console.error(`уведомление менеджера о заявке ${notification.request.id} не доставлено:`, error);
    return "failed";
  }
}
