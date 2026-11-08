import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { RateBucket } from "../domain/antispam.ts";

/**
 * Атомарный счётчик в БД (RPC check_rate_limit). Возвращает сырое решение; разбирает его domain/antispam.
 * bucket — отдельное окно на вид входа: текст вне сценария и нажатия кнопок считаются независимо (S07).
 */
export async function checkRateLimit(
  client: SupabaseClient,
  input: { externalUserId: number; bucket: RateBucket; max: number; windowSeconds: number },
): Promise<unknown> {
  const { data, error } = await client.rpc("check_rate_limit", {
    p_external_user_id: input.externalUserId,
    p_max: input.max,
    p_window_seconds: input.windowSeconds,
    p_bucket: input.bucket,
  });
  if (error) throw error;
  return data;
}
