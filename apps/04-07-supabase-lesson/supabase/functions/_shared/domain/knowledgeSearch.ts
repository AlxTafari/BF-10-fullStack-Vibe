// Правила векторного поиска по базе знаний (S10 §4.4, §4.8). Чистые функции и константы.
// Боевой поиск ранжирует в SQL (миграция match_knowledge), проверка в памяти (pnpm eval:rag) — здесь;
// правила обязаны совпадать, иначе eval ничего не говорит о боевом поиске.

/**
 * Порог сходства «явный мусор». Низкий намеренно: на мок-базе вопросы без ответа находят близкий по теме
 * документ («криптовалюта» → «Оплата», 0.636), а у правильных источников бывает 0.635. Чистого порога нет —
 * решение «в найденном ответа нет» принимает модель (§4.4). Пересматривается по pnpm eval:rag.
 */
export const KNOWLEDGE_SEARCH_THRESHOLD = 0.6;
/** Разных источников в ответе: модели хватает на ответ, а контекст хода не раздувается. */
export const KNOWLEDGE_SEARCH_LIMIT = 5;
/** Длина запроса tool searchKnowledge: длиннее — это не поисковая фраза, а пересказ диалога. */
export const KNOWLEDGE_QUERY_MAX_LENGTH = 500;

export type KnowledgeSourceKind = "document" | "dish";

/** Фрагмент с уже посчитанным сходством с запросом. */
export interface ScoredChunk {
  source: KnowledgeSourceKind;
  id: string;
  chunkIndex: number;
  score: number;
}

/** Порядок результатов: сходство по убыванию, равные — по (source, id, chunkIndex), как в SQL. */
function compare(a: ScoredChunk, b: ScoredChunk): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return a.chunkIndex - b.chunkIndex;
}

/**
 * Лучший фрагмент каждого источника → порог → сортировка → лимит. Фильтры «ресторан, публикация, актуальная
 * версия» — до этой функции: на вход приходят только допустимые фрагменты.
 */
export function rankKnowledge(
  chunks: ScoredChunk[],
  threshold = KNOWLEDGE_SEARCH_THRESHOLD,
  limit = KNOWLEDGE_SEARCH_LIMIT,
): ScoredChunk[] {
  const best = new Map<string, ScoredChunk>();
  for (const chunk of chunks) {
    const key = `${chunk.source}:${chunk.id}`;
    const current = best.get(key);
    // compare < 0 — chunk идёт раньше: выше сходство или при равном — меньший номер фрагмента.
    if (!current || compare(chunk, current) < 0) best.set(key, chunk);
  }
  return [...best.values()].filter((c) => c.score >= threshold).sort(compare).slice(0, limit);
}
