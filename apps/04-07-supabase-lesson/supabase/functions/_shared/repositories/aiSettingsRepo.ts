import type { SupabaseClient } from "@supabase/supabase-js";

/** Сырая строка restaurant_ai_settings; разбор и дефолты — domain/aiSettings.ts. null — строки нет. */
export async function getAiSettingsRow(
  client: SupabaseClient,
  restaurantId: string,
): Promise<{ ai_enabled: unknown; history_window: unknown; daily_turn_limit: unknown } | null> {
  const { data, error } = await client
    .from("restaurant_ai_settings")
    .select("ai_enabled, history_window, daily_turn_limit")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
