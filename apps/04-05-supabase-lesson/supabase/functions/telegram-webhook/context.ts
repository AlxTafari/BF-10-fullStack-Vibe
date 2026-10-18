import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { TelegramClient } from "../_shared/telegram/client.ts";
import type { ConversationRow } from "../_shared/types.ts";

export interface HandlerContext {
  client: SupabaseClient;
  tg: TelegramClient;
  chatId: number;
  /** @username гостя из текущего апдейта (без @), если он у него есть. */
  username: string | null;
  conversation: ConversationRow;
  /** Личный чат: только в нём бот удаляет дубли и правит сообщения на месте (S06d). */
  isPrivate: boolean;
  /** message_id сообщения, под которым нажата кнопка; null для текстовых апдейтов. */
  callbackMessageId: number | null;
}
