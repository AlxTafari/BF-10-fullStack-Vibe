import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type FieldError, validateContact, validateRequestText } from "../domain/fieldValidation.ts";
import { GUEST_REQUEST_KINDS, type GuestRequestKind } from "../domain/flowState.ts";
import { findGuestRequestByKey, insertGuestRequest } from "../repositories/guestRequestsRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { GuestRequestRow } from "../types.ts";

export interface CreateGuestRequestInput {
  conversationId: string;
  /** Идентификатор черновика из состояния сценария; вместе с диалогом задаёт ключ идемпотентности. */
  draftId: string;
  kind: GuestRequestKind;
  text: string;
  /** Для вопроса менеджеру обязателен, для отзыва и жалобы — null допустим. */
  contact: string | null;
}

export type GuestRequestField = "kind" | "text" | "contact";
export type GuestRequestFieldErrors = Partial<Record<GuestRequestField, FieldError | "invalid_kind" | "contact_required">>;

export type CreateGuestRequestResult =
  | { ok: true; request: GuestRequestRow; created: boolean }
  | { ok: false; errors: GuestRequestFieldErrors };

/** Создаёт обращение (статус new). Идемпотентна так же, как createBookingRequest. */
export async function createGuestRequest(
  client: SupabaseClient,
  input: CreateGuestRequestInput,
): Promise<CreateGuestRequestResult> {
  const key = `guest:${input.conversationId}:${input.draftId}`;

  const existing = await findGuestRequestByKey(client, key);
  if (existing) return { ok: true, request: existing, created: false };

  const restaurant = await getRestaurant(client);
  if (!restaurant) throw new Error("ресторан не заведён");

  const errors: GuestRequestFieldErrors = {};
  if (!GUEST_REQUEST_KINDS.includes(input.kind)) errors.kind = "invalid_kind";
  const text = validateRequestText(input.text);
  if (!text.ok) errors.text = text.error;

  let contact: string | null = null;
  if (input.contact === null) {
    if (input.kind === "manager_request") errors.contact = "contact_required";
  } else {
    const v = validateContact(input.contact);
    if (v.ok) contact = v.value;
    else errors.contact = v.error;
  }

  if (Object.keys(errors).length > 0 || !text.ok) return { ok: false, errors };

  const { request, created } = await insertGuestRequest(client, {
    restaurant_id: restaurant.id,
    conversation_id: input.conversationId,
    kind: input.kind,
    text: text.value,
    contact,
    idempotency_key: key,
  });
  return { ok: true, request, created };
}
