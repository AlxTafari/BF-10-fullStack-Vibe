import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  type DocumentValues,
  type IndexOutcome,
  type KnowledgeSource,
  type ReindexPortion,
  type SourceRef,
  indexErrorText,
  saveErrorText,
  toSaveArgs,
} from "@/domain/knowledge";
import { baseApi } from "./baseApi";
import type { Tables } from "./database.types";
import { type ApiError, toApiError } from "./errors";
import { supabase } from "./supabaseClient";

export type KnowledgeDocument = Tables<"knowledge_documents">;

/** Строка списка: без текста документа — 59 документов по 20 000 символов незачем тянуть ради таблицы. */
export type KnowledgeDocumentRow = Pick<
  KnowledgeDocument,
  "id" | "title" | "type" | "is_published" | "index_status" | "index_error" | "index_revision" | "indexed_revision" | "updated_at"
>;

/** Документ для редактора: строка + блюда подборки в порядке sort_order. */
export interface KnowledgeDocumentFull {
  document: KnowledgeDocument;
  dishIds: string[];
}

const LIST_COLUMNS = "id, title, type, is_published, index_status, index_error, index_revision, indexed_revision, updated_at";

/**
 * Вызов Edge Function knowledge-index. Ошибка функции (4xx/5xx) приходит как FunctionsHttpError, код — в теле
 * ({ error: "ai_unavailable" }); переводим в текст для менеджера. Сетевой сбой — общим toApiError.
 */
async function invokeIndexer<T>(body: Record<string, unknown>): Promise<{ data: T } | { error: ApiError }> {
  const { data, error } = await supabase.functions.invoke<T>("knowledge-index", { body });
  if (!error) return { data: data as T };
  if (error instanceof FunctionsHttpError) {
    let code: string | undefined;
    try {
      code = ((await error.context.json()) as { error?: string }).error;
    } catch {
      code = undefined;
    }
    return { error: { message: indexErrorText(code), ...(code ? { code } : {}) } };
  }
  return { error: toApiError(error) };
}

export const knowledgeApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getKnowledgeDocuments: build.query<KnowledgeDocumentRow[], string>({
      queryFn: async (restaurantId) => {
        const { data, error } = await supabase
          .from("knowledge_documents")
          .select(LIST_COLUMNS)
          .eq("restaurant_id", restaurantId)
          .order("updated_at", { ascending: false })
          .order("id");
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: ["KnowledgeDocument"],
    }),

    getKnowledgeDocument: build.query<KnowledgeDocumentFull, string>({
      queryFn: async (id) => {
        // Связи — вложенным select по FK: документ и состав подборки одним запросом.
        const { data, error } = await supabase
          .from("knowledge_documents")
          .select("*, knowledge_document_dishes(menu_item_id, sort_order)")
          .eq("id", id)
          .maybeSingle();
        if (error) return { error: toApiError(error) };
        // Чужой (RLS) и несуществующий документ неотличимы.
        if (!data) return { error: { message: "Документ не найден — возможно, его удалили", code: "not_found" } };
        const { knowledge_document_dishes: links, ...document } = data;
        const dishIds = [...links]
          .sort((a, b) => a.sort_order - b.sort_order || a.menu_item_id.localeCompare(b.menu_item_id))
          .map((l) => l.menu_item_id);
        return { data: { document, dishIds } };
      },
      providesTags: (_r, _e, id) => [{ type: "KnowledgeDocument", id }],
    }),

    // Документ и состав подборки — одной транзакцией в RPC; ресторан RPC берёт из членства менеджера.
    // Возвращает id (для нового документа — новый). Перечитанная строка (статус индексации) придёт по тегу.
    saveKnowledgeDocument: build.mutation<string, { id: string | null; values: DocumentValues }>({
      queryFn: async ({ id, values }) => {
        const args = toSaveArgs(id, values);
        // Генератор типов считает все аргументы функции обязательными строками, хотя p_id = null (новый документ)
        // SQL-функция принимает: аргумент uuid без not null. Приведение только для p_id.
        const { data, error } = await supabase.rpc("save_knowledge_document", { ...args, p_id: args.p_id as string });
        if (error) {
          const text = saveErrorText(error.message);
          return { error: text ? { message: text, code: error.message } : toApiError(error) };
        }
        return { data };
      },
      invalidatesTags: ["KnowledgeDocument"],
    }),

    // Чанки и связи удаляет БД по FK (on delete cascade).
    deleteKnowledgeDocument: build.mutation<null, string>({
      queryFn: async (id) => {
        const { error } = await supabase.from("knowledge_documents").delete().eq("id", id);
        return error ? { error: toApiError(error) } : { data: null };
      },
      invalidatesTags: ["KnowledgeDocument"],
    }),

    // Индексация одного источника. Отдельный запрос после сохранения: его сбой не откатывает сохранение.
    // После ответа перечитываем строки — статус в UI всегда из БД.
    indexKnowledgeSource: build.mutation<IndexOutcome, SourceRef>({
      queryFn: ({ source, id }) => invokeIndexer<IndexOutcome>({ action: source, id }),
      invalidatesTags: (_r, _e, { source }) => [sourceTag(source)],
    }),

    // Одна порция «Переиндексировать всё». Порции вызывает экран по очереди, пока nextCursor не станет null.
    reindexKnowledgePortion: build.mutation<ReindexPortion, { restaurantId: string; cursor: SourceRef | null }>({
      queryFn: ({ restaurantId, cursor }) => invokeIndexer<ReindexPortion>({ action: "all", restaurantId, cursor }),
      // Перечитываем после каждой порции: таблица документов показывает прогресс статусами.
      invalidatesTags: ["KnowledgeDocument", "MenuItem"],
    }),
  }),
});

function sourceTag(source: KnowledgeSource) {
  return source === "document" ? ("KnowledgeDocument" as const) : ("MenuItem" as const);
}

export const {
  useGetKnowledgeDocumentsQuery,
  useGetKnowledgeDocumentQuery,
  useLazyGetKnowledgeDocumentQuery,
  useSaveKnowledgeDocumentMutation,
  useDeleteKnowledgeDocumentMutation,
  useIndexKnowledgeSourceMutation,
  useReindexKnowledgePortionMutation,
} = knowledgeApi;
