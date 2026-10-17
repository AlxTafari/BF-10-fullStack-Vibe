import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { upsertConversation } from "../repositories/conversationsRepo.ts";
import { logMessage } from "../repositories/messagesRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { ConversationRow, MessageDirection, MessageKind } from "../types.ts";

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

/**
 * Сохраняет сообщение диалога — для входящих и исходящих. last_message_at и превью для списка админки
 * обновляет триггер messages_after_insert в той же транзакции, поэтому здесь второго запроса нет.
 */
export async function recordMessage(
  client: SupabaseClient,
  conversationId: string,
  direction: MessageDirection,
  text: string,
  kind: MessageKind = "text",
): Promise<void> {
  await logMessage(client, { conversationId, direction, text, kind });
}
