import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { UserRow } from "../types.ts";

export async function findUserByTgId(
  client: SupabaseClient,
  tgId: number,
): Promise<UserRow | null> {
  const { data, error } = await client
    .from("users")
    .select("*")
    .eq("tg_id", tgId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** /start на новом юзере: создаёт "пустую" строку — заполняется по ходу онбординга. */
export async function createPendingUser(
  client: SupabaseClient,
  tgId: number,
): Promise<UserRow> {
  const { data, error } = await client
    .from("users")
    .insert({ tg_id: tgId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setUserName(
  client: SupabaseClient,
  userId: string,
  name: string,
): Promise<UserRow> {
  const { data, error } = await client
    .from("users")
    .update({ name })
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setUserCamp(
  client: SupabaseClient,
  userId: string,
  campId: string,
): Promise<UserRow> {
  const { data, error } = await client
    .from("users")
    .update({ camp_id: campId })
    .eq("id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function touchLastMessageAt(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("users")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

export interface ActiveResident {
  user: UserRow;
  campName: string | null;
  newsCount: number;
}

/** /жители: активные за 30 дней, с именем лагеря и числом своих (не анонимных) сплетен. */
export async function listActiveResidents(
  client: SupabaseClient,
): Promise<ActiveResident[]> {
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: users, error: usersError } = await client
    .from("users")
    .select("*, camp:camps(name)")
    .gte("last_message_at", sinceIso)
    .order("last_message_at", { ascending: false });
  if (usersError) throw usersError;
  if (!users || users.length === 0) return [];

  const { data: authoredNews, error: newsError } = await client
    .from("news")
    .select("author_id")
    .not("author_id", "is", null)
    .in("author_id", users.map((u) => u.id));
  if (newsError) throw newsError;

  const newsCountByAuthor = new Map<string, number>();
  for (const row of authoredNews ?? []) {
    const authorId = row.author_id as string;
    newsCountByAuthor.set(authorId, (newsCountByAuthor.get(authorId) ?? 0) + 1);
  }

  return users.map((u) => ({
    user: u,
    campName: (u as unknown as { camp: { name: string } | null }).camp?.name ?? null,
    newsCount: newsCountByAuthor.get(u.id) ?? 0,
  }));
}
