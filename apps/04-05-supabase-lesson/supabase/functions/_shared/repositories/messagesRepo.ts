import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageDirection, MessageKind } from "../types.ts";

export async function logMessage(
  client: SupabaseClient,
  input: { conversationId: string; direction: MessageDirection; text: string; kind?: MessageKind },
): Promise<void> {
  const { error } = await client.from("messages").insert({
    conversation_id: input.conversationId,
    direction: input.direction,
    text: input.text,
    kind: input.kind ?? "text",
  });
  if (error) throw error;
}
