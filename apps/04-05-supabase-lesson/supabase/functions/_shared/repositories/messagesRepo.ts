import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageDirection, MessageKind, MessageMeta } from "../types.ts";

export async function logMessage(
  client: SupabaseClient,
  input: { conversationId: string; direction: MessageDirection; text: string; kind?: MessageKind; meta?: MessageMeta },
): Promise<void> {
  const { error } = await client.from("messages").insert({
    conversation_id: input.conversationId,
    direction: input.direction,
    text: input.text,
    kind: input.kind ?? "text",
    meta: input.meta ?? null,
  });
  if (error) throw error;
}

/**
 * Последние `limit` сообщений диалога заданных видов — окно истории для агента (S09), по возрастанию времени.
 * Берём «последние N» сортировкой по убыванию (индекс messages_cursor_idx) и разворачиваем.
 * manager — реплику написал менеджер из админки (meta.manager, S06b): агенту её надо отличать от своих.
 */
export async function listRecentMessages(
  client: SupabaseClient,
  conversationId: string,
  kinds: MessageKind[],
  limit: number,
): Promise<{ direction: MessageDirection; text: string; manager: boolean }[]> {
  const { data, error } = await client
    .from("messages")
    .select("direction, text, meta")
    .eq("conversation_id", conversationId)
    .in("kind", kinds)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as { direction: MessageDirection; text: string; meta: Record<string, unknown> | null }[];
  return rows.reverse().map((r) => ({ direction: r.direction, text: r.text, manager: r.meta?.manager === true }));
}

/** Сколько ответов агента ушло в диалог за [from, to) — для суточного лимита. Строки не выбираем, только счётчик. */
export async function countAiReplies(
  client: SupabaseClient,
  conversationId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const { count, error } = await client
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "out")
    // meta @> {"ai": true}: запасные ответы (aiFallback) в лимит не идут.
    .contains("meta", { ai: true })
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString());
  if (error) throw error;
  return count ?? 0;
}
