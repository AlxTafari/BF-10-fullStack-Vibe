import type { SupabaseClient } from "@supabase/supabase-js";
import { markUpdateProcessed } from "../repositories/processedUpdatesRepo.ts";

/** true — апдейт новый, обрабатываем; false — повторная доставка, пропускаем (ADR-006). */
export function registerUpdate(client: SupabaseClient, updateId: number): Promise<boolean> {
  return markUpdateProcessed(client, updateId);
}
