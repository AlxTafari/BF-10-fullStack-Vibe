// Строки БД и payload'ы Realtime → типы домена. Сгенерированные типы знают только string; здесь значения
// проверяются, и неожиданная строка отбрасывается (null), а не попадает в кэш под видом сообщения.
import type { ConversationEventRow, ConversationRow } from "@/domain/conversations";
import type { Message } from "@/domain/messages";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const str = (value: unknown): value is string => typeof value === "string";
const strOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const direction = (value: unknown): value is "in" | "out" => value === "in" || value === "out";

/** Строка messages (ответ RPC или payload Realtime INSERT) → Message. */
export function toMessage(row: unknown): Message | null {
  if (!isRecord(row)) return null;
  const { id, conversation_id, direction: dir, kind, text, created_at } = row;
  if (!str(id) || !str(conversation_id) || !direction(dir) || !str(text) || !str(created_at)) return null;
  if (kind !== "text" && kind !== "button" && kind !== "search") return null;
  return { id, conversation_id, direction: dir, kind, text, created_at };
}

/** Строка ответа list_conversations_page → ConversationRow. */
export function toConversationRow(row: unknown): ConversationRow | null {
  if (!isRecord(row)) return null;
  const { id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at, unread_count } = row;
  if (!str(id) || !strOrNull(display_name) || !str(channel) || !str(created_at) || !str(last_message_at)) return null;
  if (!strOrNull(last_message_preview) || !strOrNull(manager_last_read_at) || typeof unread_count !== "number") return null;
  if (last_message_direction !== null && !direction(last_message_direction)) return null;
  return { id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at, unread_count };
}

/** Payload Realtime по conversations → то, что нужно списку. state / chat_id / external_user_id отбрасываются. */
export function toConversationEventRow(row: unknown): ConversationEventRow | null {
  if (!isRecord(row)) return null;
  const { id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at } = row;
  if (!str(id) || !strOrNull(display_name) || !str(channel) || !str(created_at) || !strOrNull(last_message_at)) return null;
  if (!strOrNull(last_message_preview) || !strOrNull(manager_last_read_at)) return null;
  if (last_message_direction !== null && !direction(last_message_direction)) return null;
  return { id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at };
}
