// Строки БД и payload'ы Realtime → типы домена. Сгенерированные типы знают только string; здесь значения
// проверяются, и неожиданная строка отбрасывается (null), а не попадает в кэш под видом сообщения.
import type { ConversationEventRow, ConversationRow } from "@/domain/conversations";
import type { Message } from "@/domain/messages";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const str = (value: unknown): value is string => typeof value === "string";
const strOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const direction = (value: unknown): value is "in" | "out" => value === "in" || value === "out";

/**
 * Пометка угрозы (S09). Колонки нет (старый ответ) — считаем «не помечен», а не отбрасываем строку: список
 * диалогов не должен пропасть из-за пометки. Неверный тип — строка отбрасывается, как и при других полях.
 */
function toFlag(row: Record<string, unknown>): { flagged_at: string | null; flag_reason: string | null } | null {
  const flagged_at = row.flagged_at ?? null;
  const flag_reason = row.flag_reason ?? null;
  if (!strOrNull(flagged_at) || !strOrNull(flag_reason)) return null;
  return { flagged_at, flag_reason };
}

/** Ручной режим (S06b). Колонки нет (старый ответ) — режима нет; неверный тип — строка отбрасывается. */
function toHandoff(row: Record<string, unknown>): { handoff_until: string | null } | null {
  const handoff_until = row.handoff_until ?? null;
  return strOrNull(handoff_until) ? { handoff_until } : null;
}

/** Пометка ответа агента из messages.meta (S09): ai — ответил агент, fallback — агент не ответил, ушёл запасной ответ. */
function toAiMark(meta: unknown): Message["ai"] {
  if (!isRecord(meta)) return null;
  if (meta.ai === true) return "reply";
  return typeof meta.aiFallback === "string" ? "fallback" : null;
}

/**
 * Голосовое из messages.meta.voice (S09, сессия 4). Нет voice — null. Неверные поля не роняют сообщение: голосовое
 * без длительности показываем с 0:00, неизвестный transcribedBy — как «не распознано» (кнопка снова доступна).
 */
function toVoice(meta: unknown): Message["voice"] {
  if (!isRecord(meta) || !isRecord(meta.voice)) return null;
  const { duration, transcribedBy, transcribeError } = meta.voice;
  return {
    duration: typeof duration === "number" ? duration : 0,
    transcribedBy: transcribedBy === "auto" || transcribedBy === "manager" ? transcribedBy : null,
    error: str(transcribeError) ? transcribeError : null,
  };
}

/** Строка messages (ответ RPC или payload Realtime INSERT) → Message. */
export function toMessage(row: unknown): Message | null {
  if (!isRecord(row)) return null;
  const { id, conversation_id, direction: dir, kind, text, created_at } = row;
  if (!str(id) || !str(conversation_id) || !direction(dir) || !str(text) || !str(created_at)) return null;
  if (kind !== "text" && kind !== "button" && kind !== "search") return null;
  const byManager = isRecord(row.meta) && row.meta.manager === true;
  return { id, conversation_id, direction: dir, kind, text, created_at, ai: toAiMark(row.meta), byManager, voice: toVoice(row.meta) };
}

/** Строка ответа list_conversations_page → ConversationRow. */
export function toConversationRow(row: unknown): ConversationRow | null {
  if (!isRecord(row)) return null;
  const { id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at, unread_count } = row;
  if (!str(id) || !strOrNull(display_name) || !str(channel) || !str(created_at) || !str(last_message_at)) return null;
  if (!strOrNull(last_message_preview) || !strOrNull(manager_last_read_at) || typeof unread_count !== "number") return null;
  if (last_message_direction !== null && !direction(last_message_direction)) return null;
  const flag = toFlag(row);
  const handoff = toHandoff(row);
  if (!flag || !handoff) return null;
  return { id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at, unread_count, ...flag, ...handoff };
}

/** Payload Realtime по conversations → то, что нужно списку. state / chat_id / external_user_id отбрасываются. */
export function toConversationEventRow(row: unknown): ConversationEventRow | null {
  if (!isRecord(row)) return null;
  const { id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at } = row;
  if (!str(id) || !strOrNull(display_name) || !str(channel) || !str(created_at) || !strOrNull(last_message_at)) return null;
  if (!strOrNull(last_message_preview) || !strOrNull(manager_last_read_at)) return null;
  if (last_message_direction !== null && !direction(last_message_direction)) return null;
  const flag = toFlag(row);
  const handoff = toHandoff(row);
  if (!flag || !handoff) return null;
  return { id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at, ...flag, ...handoff };
}
