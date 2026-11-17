export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 50;

/** Обрезает края, схлопывает пробелы. null — запрос слишком короткий/длинный, искать нечего. */
export function normalizeSearchQuery(raw: string): string | null {
  const query = raw.trim().replace(/\s+/g, " ");
  // Считаем символы, а не UTF-16 единицы: эмодзи не должен считаться за два.
  const length = [...query].length;
  if (length < MIN_QUERY_LENGTH || length > MAX_QUERY_LENGTH) return null;
  return query;
}

/**
 * Шаблон для `ilike`: «%запрос%». Спецсимволы LIKE (`\`, `%`, `_`) экранируем — иначе запрос «__»
 * совпал бы с любым названием из двух букв. Экранирование по умолчанию — обратный слэш.
 */
export function toLikePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}
