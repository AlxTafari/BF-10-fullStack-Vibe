import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { TelegramClient } from "../_shared/telegram/client.ts";
import type { ConversationRow } from "../_shared/types.ts";

export interface HandlerContext {
  client: SupabaseClient;
  tg: TelegramClient;
  chatId: number;
  conversation: ConversationRow;
}
