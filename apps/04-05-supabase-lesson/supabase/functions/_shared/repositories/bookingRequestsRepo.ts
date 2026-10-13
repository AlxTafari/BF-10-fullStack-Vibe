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
