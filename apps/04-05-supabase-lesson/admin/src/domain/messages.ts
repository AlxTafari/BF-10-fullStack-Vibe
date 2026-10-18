// Сообщения чата: вливание событий Realtime в кэш ленты, классификация, группировка по дням.
// Чистые функции: без React, сети и Redux.
import { type Cursor, type Page, compareDesc, compareTimestamptz } from "./cursor";
import { dayKey } from "./chatTime";

export interface Message {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  /**
   * text — обычное сообщение, button — нажатие кнопки гостем (текст «[кнопка] <callback_data>»),
   * search — поиск блюда свободным текстом и ответ бота на него (живёт 7 дней, S06c).
   */
  kind: "text" | "button" | "search";
  text: string;
  created_at: string;
}

export const keyOfMessage = (m: Message): Cursor => ({ at: m.created_at, id: m.id });

/**
 * Влить INSERT из Realtime в кэш ленты («новые → старые»). Возвращает ТОТ ЖЕ объект, если событие ничего не
 * меняет (кэш RTK не перерисовывается зря).
 *
 * Вставка идёт по порядку, а не «в голову»: created_at = now() = начало транзакции, два запроса гостя
 * (двойной тап) могут завершиться в порядке, обратном created_at, и более позднее по метке сообщение
 * придёт раньше. Поэтому:
 *  - чужой диалог (гонка при переключении) → игнорировать;
 *  - уже есть в кэше (дубль события или оно попало в ответ запроса) → игнорировать;
 *  - новее самого нового → в начало (обычный случай);
 *  - старее самого старого загруженного → игнорировать: придёт со страницей при прокрутке и не потеряется.
 *    Исключение — загружен весь диалог (nextCursor = null): прокрутки не будет, значит вставляем;
 *  - иначе → на своё место по общему порядку.
 */
export function applyMessageEvent(cache: Page<Message>, message: Message, conversationId: string): Page<Message> {
  if (message.conversation_id !== conversationId) return cache;
  if (cache.rows.some((r) => r.id === message.id)) return cache;

  const key = keyOfMessage(message);
  const { rows } = cache;

  const newest = rows[0];
  const oldest = rows[rows.length - 1];

  // Пустой кэш: диалог ещё без сообщений (или первая страница не пришла). Ответ запроса сольётся через mergePage.
  if (!newest || !oldest) return { ...cache, rows: [message] };

  if (compareDesc(key, keyOfMessage(newest)) <= 0) return { ...cache, rows: [message, ...rows] };

  if (compareDesc(key, keyOfMessage(oldest)) > 0 && cache.nextCursor !== null) return cache;

  // Первое место, где существующая строка стоит ПОСЛЕ новой в порядке «новые → старые».
  const index = rows.findIndex((r) => compareDesc(key, keyOfMessage(r)) < 0);
  const at = index === -1 ? rows.length : index;
  return { ...cache, rows: [...rows.slice(0, at), message, ...rows.slice(at)] };
}

/**
 * Как рисовать: пузырь, приглушённый пузырь поиска или строка «Нажата кнопка». Классификация по kind, не по
 * префиксу текста. Поиск показываем (менеджеру интересно, чего ищут), но тише обычной реплики.
 */
export function classifyMessage(message: Message): "bubble" | "search" | "button" {
  if (message.kind === "button") return "button";
  return message.kind === "search" ? "search" : "bubble";
}

const BUTTON_PREFIX = "[кнопка] ";

/** Сырой callback_data нажатия кнопки — для подсказки (title). Для остальных сообщений — как есть. */
export function buttonData(message: Message): string {
  return message.text.startsWith(BUTTON_PREFIX) ? message.text.slice(BUTTON_PREFIX.length) : message.text;
}

export interface DayGroup {
  /** "2026-10-18" — день в поясе ресторана. */
  day: string;
  /** Сообщения дня в хронологическом порядке (старые → новые). */
  messages: Message[];
}

/**
 * Группировка для экрана: кэш хранит «новые → старые», выводим в хронологическом порядке с разделителями дней.
 * День вычисляется в поясе ресторана, а не браузера.
 */
export function groupByDay(newestFirst: readonly Message[], timeZone: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const message of [...newestFirst].reverse()) {
    const day = dayKey(message.created_at, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.messages.push(message);
    else groups.push({ day, messages: [message] });
  }
  return groups;
}

/**
 * Пора ли отметить диалог прочитанным и до какого момента. Отмечаем только когда менеджер ДЕЙСТВИТЕЛЬНО видит
 * сообщения: диалог открыт, лента прокручена вниз, вкладка видима (инвариант 13). `upTo` — created_at самого
 * нового входящего текстового сообщения в кэше (то, что видели), а не «сейчас»: иначе прочитанным станет
 * сообщение, пришедшее между отрисовкой и вызовом. null — отмечать нечего.
 */
export function shouldMarkRead(
  view: { isOpen: boolean; atBottom: boolean; visible: boolean },
  newestFirst: readonly Message[],
  readAt: string | null,
): string | null {
  if (!view.isOpen || !view.atBottom || !view.visible) return null;
  const newestIncoming = newestFirst.find((m) => m.direction === "in" && m.kind === "text");
  if (!newestIncoming) return null;
  if (readAt !== null && compareTimestamptz(readAt, newestIncoming.created_at) >= 0) return null;
  return newestIncoming.created_at;
}
