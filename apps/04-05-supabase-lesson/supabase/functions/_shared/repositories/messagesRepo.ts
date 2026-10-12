import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { MessageDirection } from "../types.ts";

export async function logMessage(
  client: SupabaseClient,
  input: { conversationId: string; direction: MessageDirection; text: string },
): Promise<void> {
  const { error } = await client.from("messages").insert({
    conversation_id: input.conversationId,
    direction: input.direction,
    text: input.text,
  });
  if (error) throw error;
}
