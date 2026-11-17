// Вливание события Realtime в закэшированный список. Чистая функция: без React, сети и Redux.
//
// Список в кэше — результат запроса «строки, подходящие под фильтр, в таком-то порядке, не больше N».
// Событие приходит в любом порядке относительно ответа запроса, может дублироваться и может быть устаревшим,
// поэтому правила такие:
//  - строка из события заменяет имеющуюся, только если она не старее по updated_at;
//  - строка, которая больше не подходит под фильтр списка (сменила статус), уходит из него;
//  - строка, которая стала подходить (пришла из другой вкладки), вставляется на своё место;
//  - после вставки список обрезается до лимита — как это сделал бы сам запрос;
//  - DELETE приходит без RLS-фильтра и только с id (см. LOG S05): удаляем по id, если строка есть.

export interface MergeRow {
  id: string;
  updated_at: string;
}

export type RowEvent<T extends MergeRow> =
  | { type: "INSERT" | "UPDATE"; row: T }
  | { type: "DELETE"; id: string };

export interface ListSpec<T extends MergeRow> {
  /** Подходит ли строка под фильтр этого списка. */
  matches: (row: T) => boolean;
  /** Порядок списка (как в запросе). Тай-брейк по id — на стороне вызывающего, чтобы порядок был полным. */
  compare: (a: T, b: T) => number;
  limit: number;
}

const ts = (iso: string) => Date.parse(iso);

/** Новый массив, либо тот же самый, если событие ничего не меняет (кэш не перерисовывается зря). */
export function applyRowEvent<T extends MergeRow>(rows: readonly T[], event: RowEvent<T>, spec: ListSpec<T>): readonly T[] {
  if (event.type === "DELETE") {
    return rows.some((r) => r.id === event.id) ? rows.filter((r) => r.id !== event.id) : rows;
  }

  const { row } = event;
  const index = rows.findIndex((r) => r.id === row.id);
  const existing = index === -1 ? undefined : rows[index];

  // Опоздавшее событие не откатывает свежие данные (равное время — применяем: идемпотентно).
  if (existing && ts(existing.updated_at) > ts(row.updated_at)) return rows;

  if (!spec.matches(row)) {
    return existing ? rows.filter((r) => r.id !== row.id) : rows;
  }

  const next = existing ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];
  return next.sort(spec.compare).slice(0, spec.limit);
}
