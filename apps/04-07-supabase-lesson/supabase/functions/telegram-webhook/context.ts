import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmClient } from "../_shared/services/ai/agent.ts";
import type { GuestIdentity } from "../_shared/services/flow.ts";
import type { TelegramClient } from "../_shared/telegram/client.ts";
import type { ConversationRow } from "../_shared/types.ts";

export interface HandlerContext {
  client: SupabaseClient;
  tg: TelegramClient;
  chatId: number;
  /** @username гостя из текущего апдейта (без @), если он у него есть. */
  username: string | null;
  /** Имя из профиля Telegram (first_name) — для кнопки «Использовать Telegram» в брони. */
  firstName: string | null;
  conversation: ConversationRow;
  /** Личный чат: только в нём бот удаляет дубли и правит сообщения на месте (S06d). */
  isPrivate: boolean;
  /** message_id сообщения, под которым нажата кнопка; null для текстовых апдейтов. */
  callbackMessageId: number | null;
  /** Клиент модели для агента (S09); null — ключ или модель Gemini не заданы. Обработчики только передают его в services/ai. */
  llm: LlmClient | null;
}

/** Гость текущего апдейта для сервисов сценария. */
export function guestOf(ctx: HandlerContext): GuestIdentity {
  return { username: ctx.username, firstName: ctx.firstName };
}
