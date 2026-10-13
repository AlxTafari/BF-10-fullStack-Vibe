import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { BookingRequestRow, NewBookingRequest } from "../types.ts";
import { findByIdempotencyKey, insertIdempotent } from "./insertIdempotent.ts";

export function insertBookingRequest(
  client: SupabaseClient,
  row: NewBookingRequest,
): Promise<{ request: BookingRequestRow; created: boolean }> {
  return insertIdempotent<BookingRequestRow>(client, "booking_requests", row);
}

export function findBookingRequestByKey(client: SupabaseClient, key: string): Promise<BookingRequestRow | null> {
  return findByIdempotencyKey<BookingRequestRow>(client, "booking_requests", key);
}

export async function markBookingNotified(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client
    .from("booking_requests")
    .update({ manager_notified_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------- «Мои заявки»
// Все выборки гостя фильтруются по conversation_id: id из callback_data подделывается, чужая заявка не должна находиться.

export async function listBookingsForConversation(
  client: SupabaseClient,
  conversationId: string,
  limit: number,
): Promise<BookingRequestRow[]> {
  const { data, error } = await client
    .from("booking_requests")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("booking_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as BookingRequestRow[];
}

export async function findBookingForConversation(
  client: SupabaseClient,
  id: string,
  conversationId: string,
): Promise<BookingRequestRow | null> {
  const { data, error } = await client
    .from("booking_requests")
    .select("*")
    .eq("id", id)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return data as BookingRequestRow | null;
}

/** Без проверки владельца — только для служебных нужд (текст уведомления менеджеру). */
export async function findBookingById(client: SupabaseClient, id: string): Promise<BookingRequestRow | null> {
  const { data, error } = await client.from("booking_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as BookingRequestRow | null;
}

export async function findPendingChange(client: SupabaseClient, originalId: string): Promise<BookingRequestRow | null> {
  const { data, error } = await client
    .from("booking_requests")
    .select("*")
    .eq("replaces_id", originalId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  return data as BookingRequestRow | null;
}

/**
 * Отмена гостем: одним UPDATE с условиями (живой статус, бронь в будущем, своя заявка).
 * null — отменять нечего (уже отменена, прошла, чужая): повторное нажатие не даёт второго уведомления.
 */
export async function cancelBookingIfActive(
  client: SupabaseClient,
  id: string,
  conversationId: string,
  nowIso: string,
): Promise<BookingRequestRow | null> {
  const { data, error } = await client
    .from("booking_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("conversation_id", conversationId)
    .in("status", ["pending", "confirmed"])
    .gt("booking_at", nowIso)
    .select("*");
  if (error) throw error;
  return (data?.[0] as BookingRequestRow | undefined) ?? null;
}

/** Отмена брони отменяет и её ожидающее изменение. true — такое изменение было. */
export async function cancelPendingChanges(client: SupabaseClient, originalId: string): Promise<boolean> {
  const { data, error } = await client
    .from("booking_requests")
    .update({ status: "cancelled" })
    .eq("replaces_id", originalId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
