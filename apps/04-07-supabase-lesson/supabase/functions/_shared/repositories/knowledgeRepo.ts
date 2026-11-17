import type { SupabaseClient } from "@supabase/supabase-js";

// База знаний (S10): служебные RPC индексации (миграция knowledge_indexing) и список источников ресторана.
// RPC индексации — только service role. Проверки «источник/ресторан свой» для менеджера — userClient (RLS).

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
