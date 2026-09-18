import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { NewsRow } from "../types.ts";

export async function insertNews(
  client: SupabaseClient,
  params: { authorId: string | null; postedBy: string; campId: string | null; text: string },
): Promise<NewsRow> {
  const { data, error } = await client
    .from("news")
    .insert({
      author_id: params.authorId,
      posted_by: params.postedBy,
      camp_id: params.campId,
      text: params.text,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Дневной лимит: считает по posted_by (реальный автор), отдельно для обычных и анонимных сплетен. */
export async function countNewsPostedToday(
  client: SupabaseClient,
  postedBy: string,
  anonymous: boolean,
): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  let query = client
    .from("news")
    .select("id", { count: "exact", head: true })
    .eq("posted_by", postedBy)
    .gte("created_at", startOfDay.toISOString());
  query = anonymous ? query.is("author_id", null) : query.not("author_id", "is", null);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Пул для нпс-ответа на любое сообщение: свой лагерь + общий филлер. */
export async function getGossipPool(
  client: SupabaseClient,
  campId: string,
): Promise<NewsRow[]> {
  const { data, error } = await client
    .from("news")
    .select("*")
    .or(`camp_id.eq.${campId},camp_id.is.null`);
  if (error) throw error;
  return data ?? [];
}

export async function getCampNews(
  client: SupabaseClient,
  campId: string,
): Promise<NewsRow[]> {
  const { data, error } = await client
    .from("news")
    .select("*")
    .eq("camp_id", campId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getFillerNews(client: SupabaseClient): Promise<NewsRow[]> {
  const { data, error } = await client
    .from("news")
    .select("*")
    .is("camp_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getNewsById(
  client: SupabaseClient,
  id: string,
): Promise<NewsRow | null> {
  const { data, error } = await client.from("news").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAuthorsByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<Map<string, { id: string; name: string | null }>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await client.from("users").select("id, name").in("id", ids);
  if (error) throw error;
  const map = new Map<string, { id: string; name: string | null }>();
  for (const row of data ?? []) map.set(row.id, row);
  return map;
}
