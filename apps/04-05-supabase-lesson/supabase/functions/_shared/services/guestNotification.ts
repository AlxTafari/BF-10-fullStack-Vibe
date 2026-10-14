import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { formatBookingDecision } from "../domain/guestNotification.ts";
import { findBookingById, markBookingGuestNotified } from "../repositories/bookingRequestsRepo.ts";
import { findConversationById } from "../repositories/conversationsRepo.ts";
import { logMessage } from "../repositories/messagesRepo.ts";
import { getRestaurantById } from "../repositories/restaurantsRepo.ts";
import type { SendText } from "./managerNotification.ts";

export type GuestNotifyResult = "sent" | "skipped" | "failed";

/**
 * Сообщает гостю о решении менеджера по брони и ставит guest_notified_at.
 * Вызывается из Edge Function notify-guest по запросу триггера БД (только когда статус менял менеджер через RPC).
 *
 * `expectedStatus` — статус, о котором говорил триггер. Если заявка с тех пор изменилась, отправка пропускается:
 * о новом статусе сообщит свой вызов, а гость не получит устаревшее «подтверждена».
 * Повторный вызов по уже оповещённому статусу тоже пропускается (guest_notified_at сбрасывается при каждой смене статуса).
 * Ошибка отправки не пробрасывается: решение менеджера уже сохранено, об сбое остаётся guest_notified_at = null.
 */
export async function notifyGuestOfBookingDecision(
  client: SupabaseClient,
  send: SendText,
  bookingId: string,
  expectedStatus: string,
): Promise<GuestNotifyResult> {
  try {
    const booking = await findBookingById(client, bookingId);
    if (!booking || booking.status !== expectedStatus || booking.guest_notified_at || !booking.conversation_id) {
      return "skipped";
    }

    const [conversation, restaurant] = await Promise.all([
      findConversationById(client, booking.conversation_id),
      getRestaurantById(client, booking.restaurant_id),
    ]);
    if (!conversation || !restaurant) return "skipped";

    const text = formatBookingDecision(
      {
        status: booking.status,
        booking_at: booking.booking_at,
        guests_count: booking.guests_count,
        isChange: booking.replaces_id !== null,
      },
      restaurant.timezone,
    );
    if (!text) return "skipped";

    await send(conversation.chat_id, text);
    await markBookingGuestNotified(client, booking.id);
    // Журнал диалога — вторично: сообщение гостю уже ушло, сбой записи не должен считаться недоставкой.
    await logMessage(client, { conversationId: conversation.id, direction: "out", text }).catch((error) =>
      console.error(`notify-guest: сообщение ушло, но не записалось в messages (${booking.id}):`, error)
    );
    return "sent";
  } catch (error) {
    console.error(`notify-guest: уведомление по заявке ${bookingId} не доставлено:`, error);
    return "failed";
  }
}
