// Курсорная пагинация (ADR-005). Чистые функции: без React, сети и Redux.
//
// Курсор — пара строк { at, id }, взятая ДОСЛОВНО из последней строки ответа БД. `at` никогда не проходит
// через Date и обратно: JS-Date режет микросекунды до миллисекунд, Postgres хранит микросекунды, и «скруглённый»
// курсор даёт пропуск или повтор строк на границе страницы.
// Порядок везде один: время ↓, затем id ↓ (id — только арбитр при равных метках, смысла в нём нет).

export interface Cursor {
  at: string;
  id: string;
}

/** Размер страницы сообщений и диалогов (спека S06, вопрос 8). */
export const PAGE_SIZE = 30;

/** Формат записи кэша: плоский список «новые → старые» и курсор следующей страницы (null — дошли до начала). */
export interface Page<T> {
  rows: T[];
  nextCursor: Cursor | null;
}

/** Как достать ключ порядка из строки (у сообщений — created_at, у диалогов — last_message_at). */
export type KeyOf<T> = (row: T) => Cursor;

// --- сравнение меток времени --------------------------------------------------------------------------------

// Реальные форматы (LOG S06, сверка Realtime / RPC / select): "2026-10-18T12:00:00.123456+00:00",
// но Postgres отбрасывает хвостовые нули дроби: ".12", а при нулевых микросекундах дроби нет вовсе.
// Допускаем также "Z", пробел вместо "T" и смещения "+03", "+0300", "+03:00" — на случай другого источника.
const TIMESTAMPTZ = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

interface ParsedTimestamp {
  /** Целые секунды с начала эпохи (UTC). */
  seconds: number;
  /** Дробная часть секунды в микросекундах, 0…999999. */
  micros: number;
}

function parseTimestamptz(value: string): ParsedTimestamp {
  const match = TIMESTAMPTZ.exec(value);
  if (!match) throw new Error(`Не метка времени: ${JSON.stringify(value)}`);
  const [, date = "", time = "", fraction = "", rawOffset = "Z"] = match;

  // Date.parse понимает только "+03:00": приводим смещение к этому виду.
  let offset = rawOffset;
  if (offset !== "Z") {
    const digits = offset.slice(1).replace(":", "");
    offset = `${offset.charAt(0)}${digits.slice(0, 2)}:${digits.length > 2 ? digits.slice(2) : "00"}`;
  }

  // Парсим БЕЗ дроби: так Date.parse отдаёт точные целые секунды, а микросекунды считаем сами.
  const ms = Date.parse(`${date}T${time}${offset}`);
  if (Number.isNaN(ms)) throw new Error(`Не метка времени: ${JSON.stringify(value)}`);

  // Дополняем нулями до 6 знаков: ".12" это 120000 мкс, а не 12. Больше 6 знаков Postgres не отдаёт.
  const micros = Number(fraction.padEnd(6, "0").slice(0, 6));
  return { seconds: ms / 1000, micros };
}

/** -1 / 0 / 1. Не зависит от числа знаков дроби, формы смещения и Z. Бросает на мусоре: тихий NaN сломал бы порядок. */
export function compareTimestamptz(a: string, b: string): -1 | 0 | 1 {
  const x = parseTimestamptz(a);
  const y = parseTimestamptz(b);
  if (x.seconds !== y.seconds) return x.seconds < y.seconds ? -1 : 1;
  if (x.micros !== y.micros) return x.micros < y.micros ? -1 : 1;
  return 0;
}

// --- порядок -------------------------------------------------------------------------------------------------

/**
 * Общий порядок «новые → старые»: отрицательное число, если `a` стоит в списке раньше `b`.
 * Равные метки решает id. Сравнение строк id совпадает с порядком uuid в Postgres (байты) для нижнего регистра.
 */
export function compareDesc(a: Cursor, b: Cursor): number {
  const byTime = compareTimestamptz(b.at, a.at);
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

// --- страницы ------------------------------------------------------------------------------------------------

/**
 * Правило «pageSize + 1»: клиент просит у БД на строку больше размера страницы. Получили pageSize + 1 —
 * следующая страница есть: лишнюю строку отбрасываем, курсор берём из ПОСЛЕДНЕЙ ОСТАВШЕЙСЯ.
 * Получили ≤ pageSize — конец. Иначе при количестве строк, кратном размеру страницы,
 * последняя «следующая» страница была бы пустой, а конец списка срабатывал не там.
 */
export function buildPage<T>(fetched: readonly T[], pageSize: number, keyOf: KeyOf<T>): Page<T> {
  if (pageSize < 1) throw new Error("pageSize должен быть не меньше 1");
  if (fetched.length <= pageSize) return { rows: [...fetched], nextCursor: null };
  const rows = fetched.slice(0, pageSize);
  // Курсор — строки как пришли из БД.
  const { at, id } = keyOf(rows[pageSize - 1] as T);
  return { rows, nextCursor: { at, id } };
}

/** Какой из двух курсоров «глубже» (дальше от начала списка). null — конец списка, он глубже любого. */
function deeperCursor(a: Cursor | null, b: Cursor | null): Cursor | null {
  if (a === null || b === null) return null;
  return compareDesc(a, b) >= 0 ? a : b;
}

/**
 * Влить страницу в кэш: дедуп по id, общий порядок, курсор — у самой глубокой границы.
 * Повторный запрос уже загруженной страницы курсор не откатывает назад (тогда следующая подгрузка
 * вернула бы уже имеющиеся строки).
 */
export function mergePage<T extends { id: string }>(existing: Page<T> | undefined, page: Page<T>, keyOf: KeyOf<T>): Page<T> {
  if (!existing) return page;
  const byId = new Map<string, T>();
  for (const row of existing.rows) byId.set(row.id, row);
  // Свежий ответ БД заменяет закэшированную копию строки (например, обновилось превью диалога).
  for (const row of page.rows) byId.set(row.id, row);
  const rows = [...byId.values()].sort((a, b) => compareDesc(keyOf(a), keyOf(b)));
  return { rows, nextCursor: deeperCursor(existing.nextCursor, page.nextCursor) };
}

/**
 * Влить СВЕЖУЮ первую страницу после обрыва связи. Если она не пересекается с кэшем ни одним id, а за ней
 * есть ещё строки, то за время обрыва пришло больше строк, чем помещается на страницу: между свежими и
 * старыми образовалась дыра. Тогда кэш заменяется свежей страницей, а старое подгрузится прокруткой снова.
 * Дыры в ленте быть не должно (инвариант 3 спеки S06).
 */
export function mergeFreshPage<T extends { id: string }>(existing: Page<T> | undefined, fresh: Page<T>, keyOf: KeyOf<T>): Page<T> {
  if (!existing || existing.rows.length === 0) return fresh;
  const known = new Set(existing.rows.map((r) => r.id));
  const overlaps = fresh.rows.some((r) => known.has(r.id));
  if (!overlaps && fresh.nextCursor !== null) return fresh;
  return mergePage(existing, fresh, keyOf);
}
