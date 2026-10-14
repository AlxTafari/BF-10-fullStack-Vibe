import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { RestaurantRow } from "../types.ts";

/** MVP — один ресторан: берём самый ранний. Мультиресторанность — вне первой версии. */
export async function getRestaurant(client: SupabaseClient): Promise<RestaurantRow | null> {
  const { data, error } = await client
    .from("restaurants")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as RestaurantRow | null;
}

/** Ресторан конкретной заявки: notify-guest живёт без контекста диалога, часовой пояс берём по заявке. */
export async function getRestaurantById(client: SupabaseClient, id: string): Promise<RestaurantRow | null> {
  const { data, error } = await client.from("restaurants").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as RestaurantRow | null;
}
