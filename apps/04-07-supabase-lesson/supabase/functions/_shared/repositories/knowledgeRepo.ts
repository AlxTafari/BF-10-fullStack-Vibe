import type { SupabaseClient } from "@supabase/supabase-js";

// База знаний (S10): служебные RPC индексации (миграция knowledge_indexing), список источников ресторана
// и векторный поиск match_knowledge (сессия 3). RPC индексации и поиска — только service role.
// Проверки «источник/ресторан свой» для менеджера — userClient (RLS).

/** Источник индекса. Порядок обхода массовой индексации — как в KNOWLEDGE_SOURCES: сначала документы, потом блюда. */
export type KnowledgeSource = "document" | "dish";
export const KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = ["document", "dish"];

const TABLE: Record<KnowledgeSource, string> = { document: "knowledge_documents", dish: "menu_items" };

/** Снимок индексируемых данных на момент начала попытки — эмбеддинг считается по нему, а не по свежему чтению. */
export type IndexSnapshot =
  | { source: "document"; title: string; body: string }
  | { source: "dish"; name: string; description: string | null; ingredients: string | null; categoryName: string | null };

export type BeginIndexResult =
  | { status: "not_found" | "unpublished" }
  | { status: "started"; attempt: string; revision: number; restaurantId: string; snapshot: IndexSnapshot };

export async function beginIndex(client: SupabaseClient, source: KnowledgeSource, id: string): Promise<BeginIndexResult> {
  const { data, error } = await client.rpc("begin_knowledge_index", { p_source: source, p_id: id });
  if (error) throw new Error(`begin_knowledge_index: ${error.message}`);
  const row = data as Record<string, unknown>;
  if (row.status !== "started") return { status: row.status as "not_found" | "unpublished" };
  const snapshot: IndexSnapshot = source === "document"
    ? { source, title: String(row.title), body: String(row.body) }
    : {
      source,
      name: String(row.name),
      description: (row.description as string | null) ?? null,
      ingredients: (row.ingredients as string | null) ?? null,
      categoryName: (row.category_name as string | null) ?? null,
    };
  return {
    status: "started",
    attempt: String(row.attempt),
    revision: Number(row.revision),
    restaurantId: String(row.restaurant_id),
    snapshot,
  };
}

/** Попытка, которую завершаем: finish/fail проверяют в БД, что она всё ещё последняя. */
export interface IndexAttempt {
  source: KnowledgeSource;
  id: string;
  attempt: string;
  revision: number;
}

export interface ChunkToSave {
  content: string;
  embedding: number[];
}

export async function finishIndex(client: SupabaseClient, a: IndexAttempt, chunks: ChunkToSave[]): Promise<"ready" | "superseded"> {
  const { data, error } = await client.rpc("finish_knowledge_index", {
    p_source: a.source,
    p_id: a.id,
    p_attempt: a.attempt,
    p_revision: a.revision,
    p_chunks: chunks,
  });
  if (error) throw new Error(`finish_knowledge_index: ${error.message}`);
  return data as "ready" | "superseded";
}

export async function failIndex(client: SupabaseClient, a: IndexAttempt, message: string): Promise<"error" | "superseded"> {
  const { data, error } = await client.rpc("fail_knowledge_index", {
    p_source: a.source,
    p_id: a.id,
    p_attempt: a.attempt,
    p_revision: a.revision,
    p_error: message,
  });
  if (error) throw new Error(`fail_knowledge_index: ${error.message}`);
  return data as "error" | "superseded";
}

export interface SourceRef {
  source: KnowledgeSource;
  id: string;
}

/**
 * До limit источников ресторана строго после курсора в порядке (source по KNOWLEDGE_SOURCES, id).
 * Неопубликованные тоже: массовая индексация считает их как skipped. Два запроса максимум — документы, затем блюда.
 */
export async function listSourcesAfter(
  client: SupabaseClient,
  restaurantId: string,
  after: SourceRef | null,
  limit: number,
): Promise<SourceRef[]> {
  const out: SourceRef[] = [];
  const startAt = after ? KNOWLEDGE_SOURCES.indexOf(after.source) : 0;
  for (const source of KNOWLEDGE_SOURCES.slice(startAt)) {
    if (out.length >= limit) break;
    let query = client.from(TABLE[source]).select("id").eq("restaurant_id", restaurantId);
    // Курсор внутри этого вида источников — продолжаем после него; следующий вид — с начала.
    if (after && after.source === source) query = query.gt("id", after.id);
    const { data, error } = await query.order("id", { ascending: true }).limit(limit - out.length);
    if (error) throw new Error(`${TABLE[source]}: ${error.message}`);
    out.push(...(data ?? []).map((row: { id: string }) => ({ source, id: row.id })));
  }
  return out;
}

/** Видит ли пользователь источник. Под JWT менеджера RLS отдаёт только свой ресторан: чужой и несуществующий неотличимы. */
export async function sourceVisible(userClient: SupabaseClient, source: KnowledgeSource, id: string): Promise<boolean> {
  const { data, error } = await userClient.from(TABLE[source]).select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`${TABLE[source]}: ${error.message}`);
  return data !== null;
}

/** Ресторан виден пользователю — значит, он его менеджер (политика restaurants_select через is_manager_of). */
export async function restaurantVisible(userClient: SupabaseClient, restaurantId: string): Promise<boolean> {
  const { data, error } = await userClient.from("restaurants").select("id").eq("id", restaurantId).maybeSingle();
  if (error) throw new Error(`restaurants: ${error.message}`);
  return data !== null;
}

// ---------------------------------------------------------------- поиск (S10, сессия 3)

/** Блюдо подборки с текущими полями из menu_items: состав подборки — связи, а не текст документа. */
export interface MatchedCollectionDish {
  id: string;
  name: string;
  price: number;
  currency: string;
  available: boolean;
}

/** Строка match_knowledge: источник с лучшим фрагментом. Поля документа или блюда заполнены по source. */
export type KnowledgeMatch =
  | {
    source: "document";
    id: string;
    score: number;
    title: string;
    type: string;
    content: string;
    dishes: MatchedCollectionDish[];
  }
  | { source: "dish"; id: string; score: number; name: string; price: number; currency: string; available: boolean };

interface MatchRow {
  source: KnowledgeSource;
  id: string;
  score: number;
  title: string | null;
  doc_type: string | null;
  content: string | null;
  name: string | null;
  price: number | string | null;
  currency: string | null;
  available: boolean | null;
  dishes: { id: string; name: string; price: number | string; currency: string; available: boolean }[] | null;
}

/**
 * Векторный поиск по базе знаний ресторана (RPC match_knowledge, только service role). Фильтры, лучший фрагмент
 * на источник, порог и лимит — в SQL. signal прерывает HTTP-запрос: поиск не держит ход агента дольше бюджета.
 * numeric из PostgREST может прийти строкой — приводим к числу здесь, выше по слоям цена всегда number.
 */
export async function matchKnowledge(
  client: SupabaseClient,
  input: { restaurantId: string; embedding: number[]; threshold: number; limit: number },
  signal: AbortSignal,
): Promise<KnowledgeMatch[]> {
  const { data, error } = await client.rpc("match_knowledge", {
    p_restaurant_id: input.restaurantId,
    // Массив чисел — PostgREST передаёт его текстом '[…]', это входной формат pgvector.
    p_embedding: input.embedding,
    p_threshold: input.threshold,
    p_limit: input.limit,
  }).abortSignal(signal);
  if (error) throw new Error(`match_knowledge: ${error.message}`);
  return ((data ?? []) as MatchRow[]).map((row): KnowledgeMatch =>
    row.source === "document"
      ? {
        source: "document",
        id: row.id,
        score: row.score,
        title: row.title ?? "",
        type: row.doc_type ?? "other",
        content: row.content ?? "",
        dishes: (row.dishes ?? []).map((d) => ({ ...d, price: Number(d.price) })),
      }
      : {
        source: "dish",
        id: row.id,
        score: row.score,
        name: row.name ?? "",
        price: Number(row.price),
        currency: row.currency ?? "",
        available: row.available === true,
      }
  );
}
