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

/** Число реакций на каждую новость из пула — для топ-3 в шапке /сплетни. */
export async function getReactionCounts(
  client: SupabaseClient,
  newsIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (newsIds.length === 0) return counts;

  const { data, error } = await client
    .from("news_reactions")
    .select("news_id")
    .in("news_id", newsIds);
  if (error) throw error;

  for (const row of data ?? []) {
    counts.set(row.news_id, (counts.get(row.news_id) ?? 0) + 1);
  }
  return counts;
}
