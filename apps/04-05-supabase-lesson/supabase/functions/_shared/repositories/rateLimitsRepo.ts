import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Атомарный счётчик в БД (RPC check_rate_limit). Возвращает сырое решение; разбирает его domain/antispam. */
export async function checkRateLimit(
  client: SupabaseClient,
  input: { externalUserId: number; max: number; windowSeconds: number },
): Promise<unknown> {
  const { data, error } = await client.rpc("check_rate_limit", {
    p_external_user_id: input.externalUserId,
    p_max: input.max,
    p_window_seconds: input.windowSeconds,
  });
  if (error) throw error;
  return data;
}
