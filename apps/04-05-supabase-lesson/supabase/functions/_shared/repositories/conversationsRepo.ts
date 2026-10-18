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

/** CAS по message_id последнего навигационного сообщения (RPC set_last_nav). true — запись обновилась. */
export async function casLastNav(
  client: SupabaseClient,
  input: { conversationId: string; expected: number | null; screen: string; messageId: number },
): Promise<boolean> {
  const { data, error } = await client.rpc("set_last_nav", {
    p_conversation_id: input.conversationId,
    p_expected: input.expected,
    p_screen: input.screen,
    p_message_id: input.messageId,
  });
  if (error) throw error;
  return data === true;
}

/** CAS по faq_answer_id (RPC set_faq_answer): swapped и прежний ответ FAQ (у него надо снять клавиатуру). */
export async function casFaqAnswer(
  client: SupabaseClient,
  input: { conversationId: string; expected: number | null; messageId: number },
): Promise<{ swapped: boolean; previousId: number | null }> {
  const { data, error } = await client.rpc("set_faq_answer", {
    p_conversation_id: input.conversationId,
    p_expected: input.expected,
    p_new: input.messageId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { swapped?: boolean; previous_id?: number | null } | undefined;
  return { swapped: row?.swapped === true, previousId: row?.previous_id ?? null };
}

/** Свежий last_nav из БД (сырой jsonb) — после проигранного CAS, когда снимок из начала апдейта устарел. */
export async function fetchLastNav(client: SupabaseClient, conversationId: string): Promise<unknown> {
  const { data, error } = await client.from("conversations").select("last_nav").eq("id", conversationId).maybeSingle();
  if (error) throw error;
  return (data as { last_nav?: unknown } | null)?.last_nav ?? null;
}
