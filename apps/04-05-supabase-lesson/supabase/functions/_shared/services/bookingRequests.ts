import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { validateSlot, type SlotError } from "../domain/bookingRules.ts";
import {
  type FieldError,
  validateComment,
  validateContact,
  validateGuests,
  validateName,
} from "../domain/fieldValidation.ts";
import { isBookingActive } from "../domain/myRequests.ts";
import { zonedDateTimeToUtc } from "../domain/zonedTime.ts";
import {
  findBookingForConversation,
  findBookingRequestByKey,
  findPendingChange,
  insertBookingRequest,
} from "../repositories/bookingRequestsRepo.ts";
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
  /** Заявка-изменение: id исходной брони этого же гостя. Без него — обычная новая бронь. */
  replacesId?: string;
  /** Для тестов; по умолчанию — текущий момент. */
  now?: Date;
}

export type BookingField = "time" | "guests" | "name" | "contact" | "comment" | "replaces";
/** not_changeable — исходной брони нет, она чужая, не активна или сама является изменением; change_exists — изменение уже запрошено. */
export type ReplacesError = "not_changeable" | "change_exists";
export type BookingFieldErrors = Partial<Record<BookingField, FieldError | SlotError | ReplacesError>>;

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
  const now = input.now ?? new Date();

  if (input.replacesId) {
    // Исходная бронь должна быть своей, живой и не быть сама изменением; второе ожидающее изменение запрещено.
    const original = await findBookingForConversation(client, input.replacesId, input.conversationId);
    if (!original || original.replaces_id !== null || !isBookingActive(original, now)) {
      errors.replaces = "not_changeable";
    } else if (await findPendingChange(client, original.id)) {
      errors.replaces = "change_exists";
    }
  }

  const slot = validateSlot(input.date, input.time, {
    now,
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

  let inserted;
  try {
    inserted = await insertBookingRequest(client, {
      restaurant_id: restaurant.id,
      conversation_id: input.conversationId,
      guest_name: name.value,
      contact: contact.value,
      booking_at: bookingAt.toISOString(),
      guests_count: guests.value,
      comment: comment.value,
      idempotency_key: key,
      replaces_id: input.replacesId ?? null,
    });
  } catch (error) {
    // Два параллельных запроса изменения одной брони: проиграл уникальный индекс «одно ожидающее изменение».
    if ((error as { code?: string }).code === "23505") return { ok: false, errors: { replaces: "change_exists" } };
    throw error;
  }
  return { ok: true, request: inserted.request, created: inserted.created };
}
