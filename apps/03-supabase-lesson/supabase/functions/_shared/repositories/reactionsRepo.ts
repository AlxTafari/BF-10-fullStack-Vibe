import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ReactionType } from "../types.ts";

/** Апсерт по unique(user_id, news_id) — апдейт reaction_type при повторном клике другим типом. */
export async function upsertReaction(
  client: SupabaseClient,
  params: { userId: string; newsId: string; reactionType: ReactionType },
): Promise<void> {
  const { error } = await client
    .from("news_reactions")
    .upsert(
      { user_id: params.userId, news_id: params.newsId, reaction_type: params.reactionType },
      { onConflict: "user_id,news_id" },
    );
  if (error) throw error;
}

/** Разбивка реакций по типам на каждую новость из пула — карточка вести в хронике показывает построчно. */
export async function getReactionCounts(
  client: SupabaseClient,
  newsIds: string[],
): Promise<Map<string, Partial<Record<ReactionType, number>>>> {
  const counts = new Map<string, Partial<Record<ReactionType, number>>>();
  if (newsIds.length === 0) return counts;

  const { data, error } = await client
    .from("news_reactions")
    .select("news_id, reaction_type")
    .in("news_id", newsIds);
  if (error) throw error;

  for (const row of data ?? []) {
    const byType = counts.get(row.news_id) ?? {};
    byType[row.reaction_type as ReactionType] = (byType[row.reaction_type as ReactionType] ?? 0) + 1;
    counts.set(row.news_id, byType);
  }
  return counts;
}

/** Какую реакцию этот пользователь уже поставил конкретной вести — для галочки на кнопке. */
export async function getUserReaction(
  client: SupabaseClient,
  userId: string,
  newsId: string,
): Promise<ReactionType | null> {
  const { data, error } = await client
    .from("news_reactions")
    .select("reaction_type")
    .eq("user_id", userId)
    .eq("news_id", newsId)
    .maybeSingle();
  if (error) throw error;
  return (data?.reaction_type as ReactionType | undefined) ?? null;
}
