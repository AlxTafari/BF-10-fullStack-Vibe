import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Отмечает апдейт Telegram обработанным. Возвращает false, если такой update_id уже был
 * (повторная доставка) — вызывающий код тогда ничего не делает.
 * `ignoreDuplicates` превращает вставку в `ON CONFLICT DO NOTHING`: при дубле строк не возвращается.
 */
export async function markUpdateProcessed(client: SupabaseClient, updateId: number): Promise<boolean> {
  const { data, error } = await client
    .from("processed_updates")
    .upsert({ update_id: updateId }, { onConflict: "update_id", ignoreDuplicates: true })
    .select("update_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
