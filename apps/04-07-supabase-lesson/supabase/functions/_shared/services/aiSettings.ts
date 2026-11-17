import type { SupabaseClient } from "@supabase/supabase-js";
import { type AiSettings, DEFAULT_AI_SETTINGS, parseAiSettings } from "../domain/aiSettings.ts";
import { getAiSettingsRow } from "../repositories/aiSettingsRepo.ts";

/**
 * Настройки AI ресторана с дефолтами (S09 §4.15). Строки нет — дефолты (AI включён).
 * Сбой чтения — AI считаем выключенным: менеджер мог его выключить, и рубильник важнее удобства;
 * гость получает поведение до S09, кнопки работают.
 */
export async function getAiSettings(client: SupabaseClient, restaurantId: string): Promise<AiSettings> {
  try {
    return parseAiSettings(await getAiSettingsRow(client, restaurantId));
  } catch (error) {
    console.error("ai settings read failed:", error instanceof Error ? error.name : "unknown");
    return { ...DEFAULT_AI_SETTINGS, aiEnabled: false };
  }
}
