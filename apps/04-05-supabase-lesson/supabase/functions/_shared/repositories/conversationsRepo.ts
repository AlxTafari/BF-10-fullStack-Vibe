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

/** Сохраняет состояние сценария целиком (`{}` = сценария нет). */
export async function setConversationState(
  client: SupabaseClient,
  conversationId: string,
  state: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from("conversations").update({ state }).eq("id", conversationId);
  if (error) throw error;
}

/**
 * Сбрасывает состояние, только если оно ещё принадлежит этому черновику. true — сбросили мы,
 * false — уже сбросил кто-то другой (параллельный тап по той же кнопке). Один UPDATE с условием атомарен,
 * поэтому из нескольких одновременных обработчиков true получит ровно один.
 */
export async function clearStateIfDraft(
  client: SupabaseClient,
  conversationId: string,
  draftId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("conversations")
    .update({ state: {} })
    .eq("id", conversationId)
    .eq("state->>draftId", draftId)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function findConversationById(client: SupabaseClient, id: string): Promise<ConversationRow | null> {
  const { data, error } = await client.from("conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as ConversationRow | null;
}
