import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { GuestRequestRow, NewGuestRequest } from "../types.ts";
import { findByIdempotencyKey, insertIdempotent } from "./insertIdempotent.ts";

export function insertGuestRequest(
  client: SupabaseClient,
  row: NewGuestRequest,
): Promise<{ request: GuestRequestRow; created: boolean }> {
  return insertIdempotent<GuestRequestRow>(client, "guest_requests", row);
}

export function findGuestRequestByKey(client: SupabaseClient, key: string): Promise<GuestRequestRow | null> {
  return findByIdempotencyKey<GuestRequestRow>(client, "guest_requests", key);
}

export async function markGuestRequestNotified(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client
    .from("guest_requests")
    .update({ manager_notified_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
