import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function logMessage(
  client: SupabaseClient,
  params: { userId: string; direction: "in" | "out"; text: string },
): Promise<void> {
  const { error } = await client.from("messages").insert({
    user_id: params.userId,
    direction: params.direction,
    text: params.text,
  });
  if (error) throw error;
}
