import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { validateSlot, type SlotError } from "../domain/bookingRules.ts";
import {
  type FieldError,
  validateComment,
  validateContact,
  validateGuests,
  validateName,
} from "../domain/fieldValidation.ts";
import { zonedDateTimeToUtc } from "../domain/zonedTime.ts";
import { findBookingRequestByKey, insertBookingRequest } from "../repositories/bookingRequestsRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { BookingRequestRow } from "../types.ts";

export interface CreateBookingRequestInput {
  conversationId: string;
  /** Идентификатор черновика из состояния сценария; вместе с диалогом задаёт ключ идемпотентности. */
  draftId: string;
  date: string; // YYYY-MM-DD в часовом поясе ресторана
  time: string; // HH:00
  guests: number;
  name: string;
  contact: string;
  comment: string | null;
  /** Для тестов; по умолчанию — текущий момент. */
  now?: Date;
}

export type BookingField = "time" | "guests" | "name" | "contact" | "comment";
export type BookingFieldErrors = Partial<Record<BookingField, FieldError | SlotError>>;

export type CreateBookingRequestResult =
  | { ok: true; request: BookingRequestRow; created: boolean }
  | { ok: false; errors: BookingFieldErrors };

/**
 * Создаёт заявку на бронь (статус pending — это не подтверждённая бронь). Идемпотентна:
 * повторный вызов с тем же диалогом и draftId возвращает ту же заявку с `created: false`.
 * Поля проверяются здесь же, а не только в сценарии: сервис станет tool'ом для LLM (ADR-004).
 */
export async function createBookingRequest(
  client: SupabaseClient,
  input: CreateBookingRequestInput,
): Promise<CreateBookingRequestResult> {
  const key = `booking:${input.conversationId}:${input.draftId}`;

  // Заявка уже есть → отдаём её как есть. Валидацию «сегодня + 30 мин» повторять нельзя: между первым
  // и повторным нажатием время ушло вперёд, и корректная заявка вдруг стала бы «слишком скорой».
  const existing = await findBookingRequestByKey(client, key);
  if (existing) return { ok: true, request: existing, created: false };

  const restaurant = await getRestaurant(client);
  if (!restaurant) throw new Error("ресторан не заведён");

  const errors: BookingFieldErrors = {};
  const slot = validateSlot(input.date, input.time, {
    now: input.now ?? new Date(),
    timeZone: restaurant.timezone,
    openingHours: restaurant.opening_hours,
  });
  if (!slot.ok) errors.time = slot.error;
  const bookingAt = slot.ok ? zonedDateTimeToUtc(input.date, input.time, restaurant.timezone) : null;
  // Время, которого нет на часах (перевод стрелок), для брони так же непригодно.
  if (slot.ok && !bookingAt) errors.time = "bad_time";

  const guests = validateGuests(input.guests);
  if (!guests.ok) errors.guests = guests.error;
  const name = validateName(input.name);
  if (!name.ok) errors.name = name.error;
  const contact = validateContact(input.contact);
  if (!contact.ok) errors.contact = contact.error;
  const comment = input.comment === null ? ({ ok: true, value: null } as const) : validateComment(input.comment);
  if (!comment.ok) errors.comment = comment.error;

  if (Object.keys(errors).length > 0 || !bookingAt || !guests.ok || !name.ok || !contact.ok || !comment.ok) {
    return { ok: false, errors };
  }

  const { request, created } = await insertBookingRequest(client, {
    restaurant_id: restaurant.id,
    conversation_id: input.conversationId,
    guest_name: name.value,
    contact: contact.value,
    booking_at: bookingAt.toISOString(),
    guests_count: guests.value,
    comment: comment.value,
    idempotency_key: key,
  });
  return { ok: true, request, created };
}
