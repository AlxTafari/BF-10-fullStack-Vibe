// Индексация базы знаний (S10, сессия 2): источник → фрагменты → эмбеддинги → чанки в БД.
// Вызывают Edge Function knowledge-index (после сохранения в админке, кнопки «Повторить» / «Переиндексировать всё»)
// и скрипт pnpm index:seed. Ход одной попытки:
//   1. begin_knowledge_index — атомарно выдаёт номер попытки и снимок данных с index_revision;
//   2. эмбеддинги — вне транзакции БД (сеть, секунды);
//   3. finish_knowledge_index / fail_knowledge_index — пишут результат, только если попытка всё ещё последняя
//      и версия не сменилась; иначе superseded: правка, снятие с публикации или новая попытка победили.
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkDocument, dishEmbeddingText, MAX_DISH_TEXT_CHARS } from "../domain/knowledgeChunks.ts";
import { type Embedder, LlmError } from "../llm/types.ts";
import {
  beginIndex,
  failIndex,
  finishIndex,
  type IndexAttempt,
  type IndexSnapshot,
  type KnowledgeSource,
  listSourcesAfter,
  restaurantVisible,
  type SourceRef,
  sourceVisible,
} from "../repositories/knowledgeRepo.ts";

export type { KnowledgeSource, SourceRef };

export interface KnowledgeIndexDeps {
  /** Service role: служебные RPC индексации закрыты для менеджера. */
  client: SupabaseClient;
  embed: Embedder;
  /** Часы для бюджета порции; тесты подменяют. */
  now?: () => number;
}

export type IndexOutcome =
  | { status: "ready" | "skipped" | "superseded" | "not_found" }
  | { status: "error"; message: string };

/** Предел одного запроса эмбеддингов (S10 §2): документ до 20 000 символов — ≤ 9 фрагментов, одна пачка. */
export const EMBED_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Безопасный текст ошибки для index_error и админки: без ключей, без ответа провайдера, без данных.
 * Подробности (класс сбоя) — в логах функции.
 */
const ERROR_TEXT: Record<LlmError["kind"] | "too_long" | "internal", string> = {
  quota: "Исчерпан лимит запросов Gemini. Повторите позже.",
  timeout: "Gemini не ответил вовремя. Повторите позже.",
  unavailable: "Gemini недоступен. Повторите позже.",
  bad_response: "Gemini вернул некорректный ответ. Повторите позже.",
  too_long: `Название, описание и состав блюда вместе длиннее ${MAX_DISH_TEXT_CHARS} символов — сократите текст.`,
  internal: "Внутренняя ошибка индексации. Повторите позже.",
};

/** Снимок → тексты фрагментов. Блюдо длиннее предела — явная ошибка, без тихого усечения состава (§4.7). */
function textsFor(snapshot: IndexSnapshot): { ok: true; texts: string[] } | { ok: false; message: string } {
  if (snapshot.source === "document") return { ok: true, texts: chunkDocument(snapshot) };
  const text = dishEmbeddingText(snapshot);
  if (text.length > MAX_DISH_TEXT_CHARS) return { ok: false, message: ERROR_TEXT.too_long };
  return { ok: true, texts: [text] };
}

/**
 * Одна попытка индексации источника. deadline (epoch ms) — конец бюджета порции массовой индексации:
 * таймаут запроса эмбеддингов не выходит за него.
 * Не опубликован — skipped (статус pending, ошибки нет). Сбой эмбеддинга — error с сохранением старых чанков.
 * Исключение летит только при сбое самой БД.
 */
export async function indexSource(
  deps: KnowledgeIndexDeps,
  source: KnowledgeSource,
  id: string,
  options: { deadline?: number } = {},
): Promise<IndexOutcome> {
  const now = deps.now ?? Date.now;
  const begun = await beginIndex(deps.client, source, id);
  if (begun.status !== "started") return { status: begun.status === "not_found" ? "not_found" : "skipped" };

  const attempt: IndexAttempt = { source, id, attempt: begun.attempt, revision: begun.revision };
  const recordFailure = async (message: string): Promise<IndexOutcome> =>
    (await failIndex(deps.client, attempt, message)) === "error" ? { status: "error", message } : { status: "superseded" };

  const prepared = textsFor(begun.snapshot);
  if (!prepared.ok) return recordFailure(prepared.message);

  const remaining = options.deadline === undefined ? Infinity : options.deadline - now();
  let vectors: number[][];
  try {
    vectors = await deps.embed(prepared.texts, "RETRIEVAL_DOCUMENT", {
      // Минимум 1 мс: AbortSignal.timeout не принимает 0 и отрицательные значения.
      timeoutMs: Math.max(1, Math.min(EMBED_REQUEST_TIMEOUT_MS, remaining)),
    });
  } catch (error) {
    // В лог — только класс сбоя: сообщения LlmError без данных, прочие ошибки — по имени.
    console.error(`knowledge: эмбеддинг ${source} ${id} не получен:`, error instanceof LlmError ? error.message : String(error));
    return recordFailure(error instanceof LlmError ? ERROR_TEXT[error.kind] : ERROR_TEXT.internal);
  }

  const chunks = prepared.texts.map((content, i) => ({ content, embedding: vectors[i] }));
  return { status: await finishIndex(deps.client, attempt, chunks) };
}

export const indexDocument = (deps: KnowledgeIndexDeps, id: string) => indexSource(deps, "document", id);
export const indexDish = (deps: KnowledgeIndexDeps, id: string) => indexSource(deps, "dish", id);

/** Пределы порции массовой индексации (S10 §2). Параметр — для тестов; в коде всегда значения по умолчанию. */
export interface PortionLimits {
  /** Источников в одной порции. */
  size: number;
  /** Источников одновременно: больше — упрёмся в лимит запросов Gemini в минуту. */
  concurrency: number;
  /** Бюджет порции: укладываемся в лимит времени Edge Function с запасом. */
  budgetMs: number;
  /** Новый источник не начинаем, если до конца бюджета меньше этого: не успеет — только зря потратит попытку. */
  minStartMs: number;
}

export const PORTION: PortionLimits = { size: 10, concurrency: 2, budgetMs: 45_000, minStartMs: 5_000 };

export interface ReindexSummary {
  ready: number;
  error: number;
  /** Не опубликован или удалён между выборкой и началом попытки. */
  skipped: number;
  /** Источник правили во время индексации: результат отброшен, источник ждёт следующей попытки. */
  superseded: number;
  errors: { source: KnowledgeSource; id: string; message: string }[];
  /** Курсор для следующей порции; null — источники ресторана закончились. */
  nextCursor: SourceRef | null;
}

/**
 * Порция массовой индексации ресторана: до limits.size источников после cursor в стабильном порядке (source, id),
 * до limits.concurrency одновременно. Индексируются все опубликованные, в том числе уже готовые: «Переиндексировать
 * всё» нужно и после смены нарезки в коде, когда версии источников не менялись.
 * Ошибка одного источника не прерывает остальные. Клиент вызывает порции, пока nextCursor не станет null;
 * повторный запуск безопасен (каждая попытка проверяет версию сама).
 */
export async function reindexAll(
  deps: KnowledgeIndexDeps,
  restaurantId: string,
  cursor: SourceRef | null = null,
  limits: PortionLimits = PORTION,
): Promise<ReindexSummary> {
  const now = deps.now ?? Date.now;
  const deadline = now() + limits.budgetMs;
  // На один больше, чем порция: так без лишнего вызова понятно, остались ли источники после неё.
  const listed = await listSourcesAfter(deps.client, restaurantId, cursor, limits.size + 1);
  const portion = listed.slice(0, limits.size);

  const outcomes: IndexOutcome[] = [];
  let next = 0;
  // Источники берутся строго по порядку, поэтому начатые — всегда префикс порции: курсор после последнего начатого
  // не пропускает незавершённых. Первый источник начинается всегда, иначе при крошечном бюджете порции не было бы прогресса.
  const worker = async () => {
    while (next < portion.length && (next === 0 || deadline - now() >= limits.minStartMs)) {
      const i = next++;
      const { source, id } = portion[i];
      try {
        outcomes[i] = await indexSource(deps, source, id, { deadline });
      } catch (error) {
        console.error(`knowledge: сбой индексации ${source} ${id}:`, error instanceof Error ? error.message : String(error));
        outcomes[i] = { status: "error", message: ERROR_TEXT.internal };
      }
    }
  };
  await Promise.all(Array.from({ length: limits.concurrency }, worker));

  const summary: ReindexSummary = { ready: 0, error: 0, skipped: 0, superseded: 0, errors: [], nextCursor: null };
  outcomes.forEach((outcome, i) => {
    if (outcome.status === "error") {
      summary.error++;
      summary.errors.push({ ...portion[i], message: outcome.message });
    } else if (outcome.status === "not_found") {
      summary.skipped++;
    } else {
      summary[outcome.status]++;
    }
  });
  const started = next;
  const more = started < portion.length || listed.length > limits.size;
  summary.nextCursor = more ? portion[started - 1] : null;
  return summary;
}

// ---------------------------------------------------------------- проверки доступа менеджера (Edge Function)

/** Источник принадлежит ресторану менеджера. userClient — с JWT менеджера: решает RLS, а не код. */
export const managerCanIndexSource = (userClient: SupabaseClient, source: KnowledgeSource, id: string) =>
  sourceVisible(userClient, source, id);

/** Пользователь — менеджер ресторана. Переданный restaurantId сам по себе доступа не даёт. */
export const managerOfRestaurant = (userClient: SupabaseClient, restaurantId: string) =>
  restaurantVisible(userClient, restaurantId);
