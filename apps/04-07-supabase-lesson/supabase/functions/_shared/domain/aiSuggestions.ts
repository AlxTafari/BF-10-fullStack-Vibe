// Кнопки под ответом агента (S09 §4.17). Агент выбирает их в поле actions финального ответа (tool reply), но только из
// фиксированного набора: текст гостя не может породить произвольную кнопку (prompt injection).
// Подписи и callback'и — в content.ts; здесь только что именно показать.

export const SUGGESTION_KINDS = ["booking", "dish", "menu", "my_requests", "manager", "main_menu"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export type Suggestion =
  | { kind: "dish"; dishId: string }
  | { kind: Exclude<SuggestionKind, "dish"> };

export const MAX_SUGGESTIONS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isKind = (value: unknown): value is SuggestionKind =>
  typeof value === "string" && (SUGGESTION_KINDS as readonly string[]).includes(value);

/**
 * actions из reply модели → проверенный список. Всё непонятное молча отбрасывается: кнопка —
 * удобство, из-за неё ход не падает. Дубли убираются, больше MAX_SUGGESTIONS не бывает.
 * Существует ли блюдо и опубликовано ли оно — проверяет сервис (domain про БД не знает).
 */
export function parseSuggestions(raw: unknown): Suggestion[] {
  if (!Array.isArray(raw)) return [];
  const result: Suggestion[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (result.length >= MAX_SUGGESTIONS) break;
    const kind = (entry as { kind?: unknown } | null)?.kind;
    if (!isKind(kind)) continue;
    let suggestion: Suggestion;
    if (kind === "dish") {
      const dishId = (entry as { dishId?: unknown }).dishId;
      if (typeof dishId !== "string" || !UUID.test(dishId)) continue;
      suggestion = { kind, dishId: dishId.toLowerCase() };
    } else {
      suggestion = { kind };
    }
    const key = suggestion.kind === "dish" ? `dish:${suggestion.dishId}` : suggestion.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(suggestion);
  }
  return result;
}
