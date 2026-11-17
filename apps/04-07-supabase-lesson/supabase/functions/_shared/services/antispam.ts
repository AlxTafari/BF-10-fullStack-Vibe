import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRateDecision, RATE_LIMITS, type RateBucket, type RateDecision } from "../domain/antispam.ts";
import { checkRateLimit } from "../repositories/rateLimitsRepo.ts";

/**
 * Решение по входящему апдейту гостя в окне `bucket` (текст вне сценария или нажатия кнопок).
 * Fail open: сбой счётчика (БД недоступна) не должен останавливать бота и бронирование — пропускаем.
 * В лог идёт только факт ошибки, без данных гостя.
 */
export async function checkGuestRate(
  client: SupabaseClient,
  externalUserId: number,
  bucket: RateBucket = "text",
): Promise<RateDecision> {
  try {
    const { max, windowSeconds } = RATE_LIMITS[bucket];
    const raw = await checkRateLimit(client, { externalUserId, bucket, max, windowSeconds });
    return parseRateDecision(raw);
  } catch (error) {
    console.error("check_rate_limit failed, пропускаем:", error instanceof Error ? error.message : "unknown");
    return "allowed";
  }
}
