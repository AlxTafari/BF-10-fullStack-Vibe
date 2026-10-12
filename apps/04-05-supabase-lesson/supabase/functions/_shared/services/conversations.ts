import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { touchConversation, upsertConversation } from "../repositories/conversationsRepo.ts";
import { logMessage } from "../repositories/messagesRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { ConversationRow, MessageDirection } from "../types.ts";

interface OpenConversationInput {
  externalUserId: number;
  chatId: number;
  displayName: string | null;
}

/** Находит или создаёт диалог гостя в единственном ресторане. null — ресторан не заведён (пустая БД). */
export async function openConversation(
  client: SupabaseClient,
  input: OpenConversationInput,
): Promise<ConversationRow | null> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) return null;
  return await upsertConversation(client, { restaurantId: restaurant.id, ...input });
}

/** Сохраняет сообщение диалога и обновляет last_message_at — одна операция для входящих и исходящих. */
export async function recordMessage(
  client: SupabaseClient,
  conversationId: string,
  direction: MessageDirection,
  text: string,
): Promise<void> {
  await logMessage(client, { conversationId, direction, text });
  await touchConversation(client, conversationId);
}
