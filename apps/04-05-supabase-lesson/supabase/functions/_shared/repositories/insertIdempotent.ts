import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * `insert … on conflict (idempotency_key) do nothing` и возврат строки в любом случае.
 * `created` отличает «создали сейчас» от «такая заявка уже была» (ADR-006).
 * Две параллельные вставки с одним ключом безопасны: победит одна, другая получит created = false.
 */
export async function insertIdempotent<Row>(
  client: SupabaseClient,
  table: "booking_requests" | "guest_requests",
  row: { idempotency_key: string },
): Promise<{ request: Row; created: boolean }> {
  // ignoreDuplicates → do nothing; при конфликте select вернёт пустой массив.
  const { data: inserted, error } = await client
    .from(table)
    .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("*");
  if (error) throw error;
  if (inserted && inserted.length > 0) return { request: inserted[0] as Row, created: true };

  const existing = await findByIdempotencyKey<Row>(client, table, row.idempotency_key);
  if (!existing) throw new Error(`${table}: конфликт ключа ${row.idempotency_key}, но строка не найдена`);
  return { request: existing, created: false };
}

export async function findByIdempotencyKey<Row>(
  client: SupabaseClient,
  table: "booking_requests" | "guest_requests",
  key: string,
): Promise<Row | null> {
  const { data, error } = await client.from(table).select("*").eq("idempotency_key", key).maybeSingle();
  if (error) throw error;
  return data as Row | null;
}
