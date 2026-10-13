import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  canCancelBooking,
  canChangeBooking,
  type MyBooking,
  type MyGuestRequest,
} from "../domain/myRequests.ts";
import {
  cancelBookingIfActive,
  cancelPendingChanges,
  findBookingForConversation,
  findPendingChange,
  listBookingsForConversation,
} from "../repositories/bookingRequestsRepo.ts";
import { listGuestRequestsForConversation } from "../repositories/guestRequestsRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { BookingRequestRow } from "../types.ts";

/** Сколько броней и обращений показываем в списке: больше в чате не помещается, остальное — в админке менеджера. */
export const MY_BOOKINGS_LIMIT = 10;
export const MY_GUEST_REQUESTS_LIMIT = 5;

export interface MyRequestsList {
  timeZone: string;
  bookings: MyBooking[];
  requests: MyGuestRequest[];
}

/** Заявки гостя этого диалога: чужих тут нет по построению (фильтр по conversationId в репозитории). */
export async function listMyRequests(client: SupabaseClient, conversationId: string): Promise<MyRequestsList> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) return { timeZone: "UTC", bookings: [], requests: [] };
  const [bookings, requests] = await Promise.all([
    listBookingsForConversation(client, conversationId, MY_BOOKINGS_LIMIT),
    listGuestRequestsForConversation(client, conversationId, MY_GUEST_REQUESTS_LIMIT),
  ]);
  return { timeZone: restaurant.timezone, bookings, requests };
}

export interface MyBookingDetails {
  booking: BookingRequestRow;
  /** Ожидающая заявка-изменение этой брони, если есть. */
  pendingChange: BookingRequestRow | null;
  timeZone: string;
  canCancel: boolean;
  canChange: boolean;
}

/** null — такой заявки нет у этого гостя (не существует или чужая: гостю разницу не показываем). */
export async function getMyBooking(
  client: SupabaseClient,
  conversationId: string,
  bookingId: string,
  now: Date = new Date(),
): Promise<MyBookingDetails | null> {
  const booking = await findBookingForConversation(client, bookingId, conversationId);
  if (!booking) return null;
  const restaurant = await getRestaurant(client);
  if (!restaurant) return null;
  const pendingChange = booking.replaces_id === null ? await findPendingChange(client, booking.id) : null;
  return {
    booking,
    pendingChange,
    timeZone: restaurant.timezone,
    canCancel: canCancelBooking(booking, now),
    canChange: canChangeBooking(booking, pendingChange !== null, now),
  };
}

export type CancelMyBookingResult =
  | { ok: true; booking: BookingRequestRow; alsoCancelledChange: boolean }
  | { ok: false; reason: "not_cancellable" };

/**
 * Отмена брони гостем. Мгновенная, менеджера не ждёт. Идемпотентна: повторный вызов вернёт
 * `not_cancellable`, и вызывающий не пошлёт менеджеру второе уведомление.
 */
export async function cancelMyBooking(
  client: SupabaseClient,
  conversationId: string,
  bookingId: string,
  now: Date = new Date(),
): Promise<CancelMyBookingResult> {
  const booking = await cancelBookingIfActive(client, bookingId, conversationId, now.toISOString());
  if (!booking) return { ok: false, reason: "not_cancellable" };
  // Отмена исходной брони тянет за собой её ожидающее изменение: изменять отменённое нечего.
  const alsoCancelledChange = booking.replaces_id === null ? await cancelPendingChanges(client, booking.id) : false;
  return { ok: true, booking, alsoCancelledChange };
}
