// Список диалогов: вливание событий Realtime. Чистые функции: без React, сети и Redux.
import { type Cursor, type Page, compareDesc, compareTimestamptz } from "./cursor";

/** Строка списка (ответ RPC list_conversations_page). */
export interface ConversationRow {
  id: string;
  display_name: string | null;
  channel: string;
  created_at: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_direction: "in" | "out" | null;
  manager_last_read_at: string | null;
  /** Непрочитанные входящие, потолок 100. */
  unread_count: number;
}

/** Что из строки conversations нужно списку (в событии Realtime приходит ещё state, chat_id — их здесь нет). */
export type ConversationEventRow = Omit<ConversationRow, "unread_count" | "last_message_at"> & {
  /** null — диалог создан, сообщений ещё нет (в списке не показывается). */
  last_message_at: string | null;
};

/** Строка списка → вид события Realtime (без счётчика): так сервер-ответ и событие сравниваются одним кодом. */
export function toEventRow(row: ConversationRow): ConversationEventRow {
  return {
    id: row.id,
    display_name: row.display_name,
    channel: row.channel,
    created_at: row.created_at,
    last_message_at: row.last_message_at,
    last_message_preview: row.last_message_preview,
    last_message_direction: row.last_message_direction,
    manager_last_read_at: row.manager_last_read_at,
  };
}

export const keyOfConversation = (c: ConversationRow): Cursor => ({ at: c.last_message_at, id: c.id });

const sameStamp = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && compareTimestamptz(a, b) === 0);

/** Позднее из двух отметок прочтения (null — «не читали», меньше любой). */
function laterRead(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return compareTimestamptz(a, b) >= 0 ? a : b;
}

export interface ConversationChange {
  list: Page<ConversationRow>;
  /**
   * Число непрочитанных по событию вычислить нельзя: событие не говорит, что пришло — текст гостя или
   * нажатие кнопки (кнопка двигает last_message_at, но счётчик менять не должна), и сколько осталось после
   * частичной отметки. Поэтому вместо догадки (+1) домен просит перечитать список у сервера.
   */
  needsRefresh: boolean;
}

/**
 * Влить событие `conversations` (INSERT / UPDATE) в кэш списка.
 *  - диалог без сообщений (last_message_at = null) в список не попадает; когда бот запишет первое сообщение,
 *    триггер пришлёт UPDATE, и диалог войдёт как новый;
 *  - UPDATE, в котором не изменилось ни последнее сообщение, ни превью, ни отметка прочтения (это
 *    setConversationState бота на каждом шаге сценария), игнорируется — список не перерисовывается и не дёргается;
 *  - запоздавшее событие (last_message_at старее кэша) последнее сообщение не откатывает; отметка прочтения только растёт;
 *  - отметка ≥ last_message_at (прочитали в другой вкладке) → unread_count = 0;
 *  - порядок и размер списка — как у запроса; события за пределами загруженной части списка не вставляются
 *    (придут со страницей при прокрутке), если не загружен весь список.
 */
export function applyConversationEvent(list: Page<ConversationRow>, event: ConversationEventRow): ConversationChange {
  const unchanged: ConversationChange = { list, needsRefresh: false };
  if (event.last_message_at === null) return unchanged;

  const existing = list.rows.find((r) => r.id === event.id);

  if (!existing) {
    const incoming: ConversationRow = { ...event, last_message_at: event.last_message_at, unread_count: 0 };
    const last = list.rows[list.rows.length - 1];
    // Старее загруженного, а список ещё не загружен целиком → придёт при прокрутке.
    if (last && list.nextCursor !== null && compareDesc(keyOfConversation(incoming), keyOfConversation(last)) > 0) {
      return unchanged;
    }
    const rows = [...list.rows, incoming].sort((a, b) => compareDesc(keyOfConversation(a), keyOfConversation(b)));
    // Счётчик нового диалога неизвестен (мог прийти и текст, и кнопка) — берём у сервера.
    return { list: { ...list, rows }, needsRefresh: !isFullyRead(incoming) };
  }

  const newer = compareTimestamptz(event.last_message_at, existing.last_message_at) > 0;
  const same = !newer && compareTimestamptz(event.last_message_at, existing.last_message_at) === 0;
  const read = laterRead(existing.manager_last_read_at, event.manager_last_read_at);

  const lastChanged = newer || (same && (event.last_message_preview !== existing.last_message_preview
    || event.last_message_direction !== existing.last_message_direction));
  const readChanged = !sameStamp(read, existing.manager_last_read_at);
  if (!lastChanged && !readChanged) return unchanged;

  const next: ConversationRow = {
    ...existing,
    last_message_at: newer ? event.last_message_at : existing.last_message_at,
    last_message_preview: newer || same ? event.last_message_preview : existing.last_message_preview,
    last_message_direction: newer || same ? event.last_message_direction : existing.last_message_direction,
    manager_last_read_at: read,
  };

  let needsRefresh = false;
  if (isFullyRead(next)) {
    next.unread_count = 0;
  } else if (lastChanged || readChanged) {
    needsRefresh = true; // что-то пришло или прочли «частично» — точное число знает только сервер
  }

  const rows = list.rows.map((r) => (r.id === next.id ? next : r)).sort((a, b) => compareDesc(keyOfConversation(a), keyOfConversation(b)));
  return { list: { ...list, rows }, needsRefresh };
}

/** Отметка прочтения покрывает последнее сообщение диалога. */
function isFullyRead(c: ConversationRow): boolean {
  return c.manager_last_read_at !== null && compareTimestamptz(c.manager_last_read_at, c.last_message_at) >= 0;
}
