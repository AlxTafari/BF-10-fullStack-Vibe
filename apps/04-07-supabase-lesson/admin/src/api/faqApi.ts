import type { FaqValues } from "@/domain/faqSchema";
import { type OrderChange, applyOrder, sortByOrder } from "@/domain/reorder";
import { baseApi } from "./baseApi";
import { toApiError } from "./errors";
import type { Tables } from "./database.types";
import { supabase } from "./supabaseClient";

export type FaqEntry = Tables<"faq_entries">;

export const faqApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getFaq: build.query<FaqEntry[], string>({
      queryFn: async (restaurantId) => {
        const { data, error } = await supabase.from("faq_entries").select("*").eq("restaurant_id", restaurantId);
        // Сортируем в домене, а не в SQL: тай-брейк (created_at, id) один и тот же для кэша и для оптимистичных правок.
        return error ? { error: toApiError(error) } : { data: sortByOrder(data) };
      },
      providesTags: ["Faq"],
    }),

    // Новая запись — в конец списка: sort_order = max + 1.
    createFaq: build.mutation<FaqEntry, { restaurantId: string; values: FaqValues }>({
      queryFn: async ({ restaurantId, values }) => {
        const { data: last, error: lastError } = await supabase
          .from("faq_entries")
          .select("sort_order")
          .eq("restaurant_id", restaurantId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastError) return { error: toApiError(lastError) };
        const { data, error } = await supabase
          .from("faq_entries")
          .insert({ ...values, restaurant_id: restaurantId, sort_order: (last?.sort_order ?? -1) + 1 })
          .select()
          .single();
        return error ? { error: toApiError(error) } : { data };
      },
      invalidatesTags: ["Faq"],
    }),

    updateFaq: build.mutation<FaqEntry, { id: string; values: FaqValues }>({
      queryFn: async ({ id, values }) => {
        const { data, error } = await supabase.from("faq_entries").update(values).eq("id", id).select().single();
        return error ? { error: toApiError(error) } : { data };
      },
      invalidatesTags: ["Faq"],
    }),

    deleteFaq: build.mutation<null, string>({
      queryFn: async (id) => {
        const { error } = await supabase.from("faq_entries").delete().eq("id", id);
        return error ? { error: toApiError(error) } : { data: null };
      },
      invalidatesTags: ["Faq"],
    }),

    // Переключатель «опубликован» в строке — оптимистичный: кэш меняется сразу, при ошибке откат.
    // restaurantId нужен только чтобы найти нужную запись кэша getFaq.
    setFaqPublished: build.mutation<null, { restaurantId: string; id: string; is_published: boolean }>({
      queryFn: async ({ id, is_published }) => {
        const { error } = await supabase.from("faq_entries").update({ is_published }).eq("id", id);
        return error ? { error: toApiError(error) } : { data: null };
      },
      onQueryStarted: async ({ restaurantId, id, is_published }, { dispatch, queryFulfilled }) => {
        const patch = dispatch(
          faqApi.util.updateQueryData("getFaq", restaurantId, (draft) => {
            const row = draft.find((r) => r.id === id);
            if (row) row.is_published = is_published;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),

    // Перестановка: все изменившиеся строки одним upsert (один SQL-запрос — применится целиком или никак).
    // Вызывающий передаёт `entries` (текущий список): upsert формирует и INSERT-часть, где NOT NULL колонки
    // обязательны, поэтому нужны целые строки, а не только sort_order.
    // Оптимистично: список перестраивается сразу, при ошибке откат.
    reorderFaq: build.mutation<null, { restaurantId: string; entries: FaqEntry[]; changes: OrderChange[] }>({
      queryFn: async ({ entries, changes }) => {
        const byId = new Map(changes.map((c) => [c.id, c.sort_order]));
        const rows = entries
          .filter((r) => byId.has(r.id))
          .map((r) => ({
            id: r.id,
            restaurant_id: r.restaurant_id,
            question: r.question,
            answer: r.answer,
            is_published: r.is_published,
            sort_order: byId.get(r.id) as number,
          }));
        if (rows.length === 0) return { data: null };
        const { error } = await supabase.from("faq_entries").upsert(rows, { onConflict: "id" });
        return error ? { error: toApiError(error) } : { data: null };
      },
      onQueryStarted: async ({ restaurantId, changes }, { dispatch, queryFulfilled }) => {
        const patch = dispatch(
          faqApi.util.updateQueryData("getFaq", restaurantId, (draft) => {
            const next = applyOrder(draft, changes);
            draft.splice(0, draft.length, ...next);
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),
  }),
});

export const {
  useGetFaqQuery,
  useCreateFaqMutation,
  useUpdateFaqMutation,
  useDeleteFaqMutation,
  useSetFaqPublishedMutation,
  useReorderFaqMutation,
} = faqApi;
