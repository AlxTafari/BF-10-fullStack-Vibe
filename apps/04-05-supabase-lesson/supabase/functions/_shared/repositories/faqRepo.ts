import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { FaqRow } from "../types.ts";

const COLUMNS = "id, question, answer";

export async function listPublishedFaq(client: SupabaseClient, restaurantId: string): Promise<FaqRow[]> {
  const { data, error } = await client
    .from("faq_entries")
    .select(COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("is_published", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FaqRow[];
}

export async function getPublishedFaq(
  client: SupabaseClient,
  restaurantId: string,
  faqId: string,
): Promise<FaqRow | null> {
  const { data, error } = await client
    .from("faq_entries")
    .select(COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("is_published", true)
    .eq("id", faqId)
    .maybeSingle();
  if (error) throw error;
  return data as FaqRow | null;
}
