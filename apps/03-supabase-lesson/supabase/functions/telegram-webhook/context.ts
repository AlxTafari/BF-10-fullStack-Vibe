import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { TelegramClient } from "../_shared/telegram/client.ts";

export interface HandlerContext {
  client: SupabaseClient;
  tg: TelegramClient;
  chatId: number;
}
