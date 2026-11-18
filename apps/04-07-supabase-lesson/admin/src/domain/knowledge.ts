import { z } from "zod";

// База знаний (S10): документы ресторана, подборки блюд и состояние векторного индекса.
// Здесь только чистая логика: подписи, форма, статус индексации, тексты ошибок, суммирование порций.

// ---------------------------------------------------------------- типы документов

export const DOCUMENT_TYPES = [
  "history",
  "team",
  "concept",
  "collection",
  "drinks",
  "event",
  "service",
  "season",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Русские подписи типов: в БД хранится код (check в knowledge_documents). */
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  history: "История",
  team: "Команда",
  concept: "Концепция",
  collection: "Подборка блюд",
  drinks: "Напитки",
  event: "События",
  service: "Сервис",
  season: "Сезонное",
  other: "Другое",
};

export const isDocumentType = (value: string): value is DocumentType =>
  (DOCUMENT_TYPES as readonly string[]).includes(value);

/** Подпись для кода из БД; незнакомый код (новый тип в БД раньше админки) показываем как есть. */
export const documentTypeLabel = (value: string): string => (isDocumentType(value) ? DOCUMENT_TYPE_LABEL[value] : value);

/** Параметры адреса списка: ?type=collection. Мусорное значение — без фильтра, а не ошибка маршрута. */
export const knowledgeSearchSchema = z.object({
  type: z.enum(DOCUMENT_TYPES).optional().catch(undefined),
});
export type KnowledgeSearch = z.infer<typeof knowledgeSearchSchema>;

// ---------------------------------------------------------------- форма документа

/** Те же пределы, что в check-ограничениях БД: форма не должна пропускать то, что отвергнет сервер. */
export const TITLE_MAX = 200;
export const BODY_MAX = 20_000;

// JS считает длину в UTF-16, БД (char_length) — в символах: для эмодзи форма строже БД, наоборот не бывает.
export const documentSchema = z.object({
  title: z.string().trim().min(1, "Введите название").max(TITLE_MAX, `Не длиннее ${TITLE_MAX} символов`),
  body: z.string().trim().min(1, "Введите текст").max(BODY_MAX, `Не длиннее ${BODY_MAX} символов`),
  type: z.enum(DOCUMENT_TYPES),
  is_published: z.boolean(),
  /** Блюда подборки в порядке показа. Для остальных типов игнорируются при сохранении. */
  dishIds: z.array(z.string()),
});

export type DocumentValues = z.infer<typeof documentSchema>;

export const EMPTY_DOCUMENT: DocumentValues = {
  title: "",
  body: "",
  type: "other",
  // Новый документ — черновик: в поиск бота попадёт, только когда менеджер явно опубликует.
  is_published: false,
  dishIds: [],
};

/** Аргументы RPC save_knowledge_document. Связи только у подборки — RPC иначе отвергнет запрос. */
export function toSaveArgs(id: string | null, values: DocumentValues) {
  return {
    p_id: id,
    p_title: values.title,
    p_body: values.body,
    p_type: values.type,
    p_is_published: values.is_published,
    p_dish_ids: values.type === "collection" ? values.dishIds : [],
  };
}

// ---------------------------------------------------------------- статус индексации

/** Поля индексации — одинаковые у документа и блюда (миграция S10, сессия 1). */
export interface IndexFields {
  is_published: boolean;
  index_status: string;
  index_error: string | null;
  index_revision: number;
  indexed_revision: number | null;
}

export type IndexState = "unpublished" | "pending" | "ready" | "error";

/**
 * Статус для менеджера — только по данным БД. «Готово» — при совпадающей версии: status = ready со старой
 * версией не бывает (триггер сбрасывает его в pending), но проверяем явно, как и поиск бота (match_knowledge).
 * «Индексируется» здесь нет: это состояние запроса в UI, а не строки в БД.
 */
export function indexState(row: IndexFields): IndexState {
  if (!row.is_published) return "unpublished";
  if (row.index_status === "error") return "error";
  if (row.index_status === "ready" && row.indexed_revision === row.index_revision) return "ready";
  return "pending";
}

export const INDEX_STATE_LABEL: Record<IndexState, string> = {
  unpublished: "Не опубликован",
  pending: "Ожидает индексации",
  ready: "Готово",
  error: "Ошибка",
};

/** Источник надо (пере)индексировать: опубликован, а индекс неактуален. Для pending и error доступна «Повторить». */
export const needsIndex = (row: IndexFields): boolean => {
  const state = indexState(row);
  return state === "pending" || state === "error";
};

// ---------------------------------------------------------------- ответы knowledge-index

export type KnowledgeSource = "document" | "dish";
export interface SourceRef {
  source: KnowledgeSource;
  id: string;
}

/** Ответ на { action: "document" | "dish" } — IndexOutcome сервиса бота. */
export type IndexOutcome =
  | { status: "ready" | "skipped" | "superseded" | "not_found" }
  | { status: "error"; message: string };

/** Ответ на { action: "all" } — ReindexSummary сервиса бота. */
export interface ReindexPortion {
  ready: number;
  error: number;
  skipped: number;
  superseded: number;
  errors: (SourceRef & { message: string })[];
  nextCursor: SourceRef | null;
}

export type ReindexTotals = Omit<ReindexPortion, "nextCursor"> & { portions: number };

export const EMPTY_TOTALS: ReindexTotals = { ready: 0, error: 0, skipped: 0, superseded: 0, errors: [], portions: 0 };

/** Итог массовой индексации — сумма порций; клиент вызывает их, пока nextCursor не станет null. */
export function addPortion(totals: ReindexTotals, portion: ReindexPortion): ReindexTotals {
  return {
    ready: totals.ready + portion.ready,
    error: totals.error + portion.error,
    skipped: totals.skipped + portion.skipped,
    superseded: totals.superseded + portion.superseded,
    errors: [...totals.errors, ...portion.errors],
    portions: totals.portions + 1,
  };
}

/**
 * Причина, по которой индекс источника не обновился; null — обновился. Вызывающий добавляет начало фразы
 * («Блюдо сохранено, индекс не обновлён: …»). superseded / skipped — источник правили или сняли с публикации
 * параллельно: актуальный статус покажет перечитанная строка.
 */
export function indexOutcomeText(outcome: IndexOutcome): string | null {
  switch (outcome.status) {
    case "ready":
      return null;
    case "error":
      return outcome.message;
    case "superseded":
      return "во время индексации источник изменили, нажмите «Повторить»";
    case "skipped":
      return "источник не опубликован";
    case "not_found":
      return "источник не найден, возможно, его удалили";
  }
}

/** Коды ошибок Edge Function knowledge-index ({ error: "…" } в теле ответа). */
const INDEX_ERROR_TEXT: Record<string, string> = {
  ai_unavailable: "AI не настроен: у индексатора нет ключа Gemini",
  not_found: "Источник не найден — возможно, его удалили",
  unauthorized: "Сессия истекла — войдите заново",
  bad_request: "Некорректный запрос к индексатору",
};

export function indexErrorText(code: string | undefined): string {
  return (code && INDEX_ERROR_TEXT[code]) || "Индексатор недоступен, попробуйте позже";
}

// ---------------------------------------------------------------- ошибки сохранения

/** Исключения RPC save_knowledge_document (raise exception '<код>'). */
const SAVE_ERROR_TEXT: Record<string, string> = {
  not_found: "Документ не найден — возможно, его удалили",
  dishes_only_for_collection: "Блюда можно привязать только к подборке",
  duplicate_dishes: "Блюдо выбрано дважды",
  invalid_dishes: "Среди выбранных блюд есть удалённое — обновите страницу",
};

/** Текст ошибки сохранения: известный код RPC — по-русски, иначе null (вызывающий покажет общий текст). */
export const saveErrorText = (message: string | undefined): string | null =>
  (message && SAVE_ERROR_TEXT[message]) || null;

// ---------------------------------------------------------------- подборка: выбор блюд

/** Переставить элемент списка: from → to (индексы). Новый массив, исходный не меняется. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const removed = next.splice(from, 1);
  next.splice(to, 0, ...removed);
  return next;
}

/** Добавить/убрать блюдо: новое — в конец подборки. */
export const toggleDish = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

// ---------------------------------------------------------------- параллельные вызовы с ограничением

/**
 * Обработать элементы не больше чем по `limit` одновременно (индексация блюд категории: Gemini ограничивает
 * число запросов в минуту). Ошибка одного не прерывает остальные — результат у каждого свой.
 * `shouldContinue` проверяется перед каждым новым элементом: ушли со страницы — новые вызовы не начинаем.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  shouldContinue: () => boolean = () => true,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length && shouldContinue()) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i] as T) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
