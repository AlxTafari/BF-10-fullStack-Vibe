// Ручной порядок списков (FAQ, категории меню): колонка sort_order.

export interface Ordered {
  id: string;
  sort_order: number;
  created_at: string;
}

export interface OrderChange {
  id: string;
  sort_order: number;
}

/**
 * Порядок отображения: sort_order, при равных — created_at, затем id.
 * Равные sort_order появляются после ручных вставок в БД; тай-брейк делает порядок стабильным
 * (бот сортирует по sort_order, при равных порядок у него может отличаться — нормализация при первой же перестановке это лечит).
 */
export function sortByOrder<T extends Ordered>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}

/**
 * Перенос элемента с позиции `from` на позицию `to` в списке, УЖЕ отсортированном для показа.
 * Всем элементам назначается нормализованный sort_order 0, 1, 2, …; на сервер нужны только те,
 * у кого значение реально изменилось (поэтому на вход идут целые элементы, а не только id).
 * Некорректные индексы или перенос на то же место → [] (ничего не менять).
 */
export function reorder(items: readonly Pick<Ordered, "id" | "sort_order">[], from: number, to: number): OrderChange[] {
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < items.length;
  if (!inRange(from) || !inRange(to) || from === to) return [];

  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return [];
  next.splice(to, 0, moved);

  const changes: OrderChange[] = [];
  next.forEach((item, index) => {
    if (item.sort_order !== index) changes.push({ id: item.id, sort_order: index });
  });
  return changes;
}

/** Применяет изменения к списку (для оптимистичного обновления кэша) и сортирует заново. */
export function applyOrder<T extends Ordered>(items: readonly T[], changes: readonly OrderChange[]): T[] {
  const byId = new Map(changes.map((c) => [c.id, c.sort_order]));
  return sortByOrder(items.map((item) => (byId.has(item.id) ? { ...item, sort_order: byId.get(item.id) as number } : item)));
}

/** sort_order для новой записи — в конец списка. */
export function nextSortOrder(items: readonly Pick<Ordered, "sort_order">[]): number {
  return items.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1;
}
