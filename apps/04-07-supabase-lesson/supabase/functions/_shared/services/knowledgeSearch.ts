// Поиск по базе знаний (S10, сессия 3): вопрос гостя → эмбеддинг запроса → match_knowledge.
// Вызывает tool searchKnowledge агента и проверка pnpm eval:rag --db. Про AI-агента сервис не знает: ему дают
// ресторан, текст запроса и крайний срок, он отдаёт найденное или причину, почему не нашёл.
import type { SupabaseClient } from "@supabase/supabase-js";
import { KNOWLEDGE_SEARCH_LIMIT, KNOWLEDGE_SEARCH_THRESHOLD } from "../domain/knowledgeSearch.ts";
import { type Embedder, LlmError } from "../llm/types.ts";
import { type KnowledgeMatch, matchKnowledge } from "../repositories/knowledgeRepo.ts";

export type { KnowledgeMatch, MatchedCollectionDish } from "../repositories/knowledgeRepo.ts";

/** Весь поиск (эмбеддинг + RPC) не дольше этого: остальное время хода — модели (S10 §2, сессия 3). */
export const SEARCH_TIMEOUT_MS = 8_000;
/** Сколько оставляем до конца хода на ответ модели по найденному или по остальным tools. */
export const ANSWER_RESERVE_MS = 5_000;
/** Меньше секунды на поиск не начинаем: эмбеддинг всё равно не успеет, а запрос будет оплачен. */
export const MIN_SEARCH_MS = 1_000;

export interface KnowledgeSearchDeps {
  /** Service role: match_knowledge закрыт для anon и менеджера. */
  client: SupabaseClient;
  /** null — нет GEMINI_API_KEY: поиск недоступен, остальные tools работают. */
  embed: Embedder | null;
  /** Часы для бюджета; тесты подменяют. */
  now?: () => number;
}

/**
 * ok: false — найти не удалось, и это не «ничего нет»:
 *   no_time     — до конца хода не осталось времени на поиск, запрос не начинался;
 *   timeout     — поиск не уложился в бюджет и прерван;
 *   unavailable — нет ключа, сбой эмбеддинга или БД.
 * Пустой results — поиск прошёл, но выше порога ничего нет (в том числе ещё нет актуальных чанков).
 */
export type KnowledgeSearchResult =
  | { ok: true; results: KnowledgeMatch[] }
  | { ok: false; reason: "no_time" | "timeout" | "unavailable" };

/**
 * deadline (epoch ms) — конец хода агента. Бюджет поиска = min(SEARCH_TIMEOUT_MS, deadline − ANSWER_RESERVE_MS − сейчас).
 * Не бросает. По истечении бюджета HTTP-запросы прерываются, а ответ возвращается сразу, даже если провайдер
 * таймаут проигнорировал: зависший запрос не держит ход.
 */
export async function searchKnowledge(
  deps: KnowledgeSearchDeps,
  input: { restaurantId: string; query: string; deadline: number },
): Promise<KnowledgeSearchResult> {
  const embed = deps.embed;
  if (!embed) return { ok: false, reason: "unavailable" };
  const now = deps.now ?? Date.now;
  const budget = Math.min(SEARCH_TIMEOUT_MS, input.deadline - ANSWER_RESERVE_MS - now());
  if (budget < MIN_SEARCH_MS) return { ok: false, reason: "no_time" };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, budget);
  });

  const work = (async () => {
    const [embedding] = await embed([input.query], "RETRIEVAL_QUERY", { timeoutMs: budget });
    // Эмбеддинг пришёл после истечения бюджета — в БД уже не идём: ответ всё равно никто не ждёт.
    if (controller.signal.aborted) throw new LlmError("timeout", "search budget exceeded");
    return await matchKnowledge(deps.client, {
      restaurantId: input.restaurantId,
      embedding,
      threshold: KNOWLEDGE_SEARCH_THRESHOLD,
      limit: KNOWLEDGE_SEARCH_LIMIT,
    }, controller.signal);
  })();
  // Проигравший гонку work может отклониться позже — без обработчика это было бы необработанное отклонение.
  work.catch(() => {});

  try {
    const outcome = await Promise.race([work, expired]);
    if (outcome === "timeout") {
      console.error("knowledge search: превышен бюджет поиска");
      return { ok: false, reason: "timeout" };
    }
    return { ok: true, results: outcome };
  } catch (error) {
    // В лог — только класс сбоя: текст запроса — данные гостя, текст провайдера — не для логов.
    console.error("knowledge search failed:", error instanceof LlmError ? error.kind : error instanceof Error ? error.name : "unknown");
    if (error instanceof LlmError && error.kind === "timeout") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
