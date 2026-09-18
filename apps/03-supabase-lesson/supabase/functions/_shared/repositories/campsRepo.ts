import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Camp } from "../types.ts";

export async function getCamps(client: SupabaseClient): Promise<Camp[]> {
  // order("name") ставит "Второй" перед "Первый" по кириллическому алфавиту — сортируем по id,
  // сиды используют 1111...-2222... специально в порядке "первый, второй".
  const { data, error } = await client.from("camps").select("*").order("id");
  if (error) throw error;
  return data ?? [];
}

export async function getCampById(client: SupabaseClient, id: string): Promise<Camp | null> {
  const { data, error } = await client.from("camps").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Ровно 2 лагеря в MVP — переключение просто берёт "не текущий". */
export async function getOtherCamp(
  client: SupabaseClient,
  currentCampId: string,
): Promise<Camp | null> {
  const { data, error } = await client
    .from("camps")
    .select("*")
    .neq("id", currentCampId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
