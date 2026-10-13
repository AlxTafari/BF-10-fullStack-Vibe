import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ConversationRow } from "../types.ts";

interface UpsertConversationInput {
  restaurantId: string;
  externalUserId: number;
  chatId: number;
  displayName: string | null;
}

/**
 * Находит диалог гостя или создаёт новый. `state` в payload не передаём — при повторном
 * вызове он не затирается (upsert обновляет только переданные колонки).
 */
export async function upsertConversation(
  client: SupabaseClient,
  input: UpsertConversationInput,
): Promise<ConversationRow> {
  const { data, error } = await client
    .from("conversations")
    .upsert(
      {
        restaurant_id: input.restaurantId,
        channel: "telegram",
        external_user_id: input.externalUserId,
        chat_id: input.chatId,
        display_name: input.displayName,
      },
      { onConflict: "restaurant_id,channel,external_user_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as ConversationRow;
}

export async function touchConversation(client: SupabaseClient, conversationId: string): Promise<void> {
  const { error } = await client
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw error;
}

/** Сохраняет состояние сценария целиком (`{}` = сценария нет). */
export async function setConversationState(
  client: SupabaseClient,
  conversationId: string,
  state: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from("conversations").update({ state }).eq("id", conversationId);
  if (error) throw error;
}
