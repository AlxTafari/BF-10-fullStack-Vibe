import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  parseRateDecision,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SECONDS,
  type RateDecision,
} from "../domain/antispam.ts";
import { checkRateLimit } from "../repositories/rateLimitsRepo.ts";

/**
 * Решение по входящему апдейту гостя. Fail open: сбой счётчика (БД недоступна) не должен останавливать бота и
 * бронирование — пропускаем. В лог идёт только факт ошибки, без данных гостя.
 */
export async function checkGuestRate(client: SupabaseClient, externalUserId: number): Promise<RateDecision> {
  try {
    const raw = await checkRateLimit(client, {
      externalUserId,
      max: RATE_LIMIT_MAX,
      windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    });
    return parseRateDecision(raw);
  } catch (error) {
    console.error("check_rate_limit failed, пропускаем:", error instanceof Error ? error.message : "unknown");
    return "allowed";
  }
}
