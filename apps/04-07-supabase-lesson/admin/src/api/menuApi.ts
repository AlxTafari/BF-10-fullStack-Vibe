import type { CategoryValues } from "@/domain/categorySchema";
import type { DishPayload } from "@/domain/dishSchema";
import { type OrderChange, applyOrder, sortByOrder } from "@/domain/reorder";
import { baseApi } from "./baseApi";
import type { Tables } from "./database.types";
import { toApiError } from "./errors";
import { supabase } from "./supabaseClient";

export type MenuCategory = Tables<"menu_categories">;
export type MenuItem = Tables<"menu_items">;

/** Флаги блюда, которые переключаются прямо в строке списка. */
export type ItemFlag = "is_published" | "is_available";

export const menuApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // ---------------------------------------------------------------- категории
    getCategories: build.query<MenuCategory[], string>({
      queryFn: async (restaurantId) => {
        const { data, error } = await supabase.from("menu_categories").select("*").eq("restaurant_id", restaurantId);
        return error ? { error: toApiError(error) } : { data: sortByOrder(data) };
      },
      providesTags: ["MenuCategory"],
    }),

    createCategory: build.mutation<MenuCategory, { restaurantId: string; values: CategoryValues }>({
      queryFn: async ({ restaurantId, values }) => {
        const { data: last, error: lastError } = await supabase
          .from("menu_categories")
          .select("sort_order")
          .eq("restaurant_id", restaurantId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastError) return { error: toApiError(lastError) };
        const { data, error } = await supabase
          .from("menu_categories")
          .insert({ ...values, restaurant_id: restaurantId, sort_order: (last?.sort_order ?? -1) + 1 })
          .select()
          .single();
        return error ? { error: toApiError(error) } : { data };
      },
      invalidatesTags: ["MenuCategory"],
    }),

    renameCategory: build.mutation<MenuCategory, { id: string; values: CategoryValues }>({
      queryFn: async ({ id, values }) => {
        const { data, error } = await supabase.from("menu_categories").update(values).eq("id", id).select().single();
        return error ? { error: toApiError(error) } : { data };
      },
      invalidatesTags: ["MenuCategory"],
    }),

    // Блюда категории в БД не удаляются (on delete set null): остаются «Без категории» — перечитываем и их.
    deleteCategory: build.mutation<null, string>({
      queryFn: async (id) => {
        const { error } = await supabase.from("menu_categories").delete().eq("id", id);
        return error ? { error: toApiError(error) } : { data: null };
      },
      invalidatesTags: ["MenuCategory", "MenuItem"],
    }),

    // Та же схема, что у FAQ: один upsert изменившихся строк, оптимистично, откат при ошибке.
    reorderCategories: build.mutation<
      null,
      { restaurantId: string; categories: MenuCategory[]; changes: OrderChange[] }
    >({
      queryFn: async ({ categories, changes }) => {
        const byId = new Map(changes.map((c) => [c.id, c.sort_order]));
        const rows = categories
          .filter((c) => byId.has(c.id))
          .map((c) => ({
            id: c.id,
            restaurant_id: c.restaurant_id,
            name: c.name,
            sort_order: byId.get(c.id) as number,
          }));
        if (rows.length === 0) return { data: null };
        const { error } = await supabase.from("menu_categories").upsert(rows, { onConflict: "id" });
        return error ? { error: toApiError(error) } : { data: null };
      },
      onQueryStarted: async ({ restaurantId, changes }, { dispatch, queryFulfilled }) => {
        const patch = dispatch(
          menuApi.util.updateQueryData("getCategories", restaurantId, (draft) => {
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

    // ---------------------------------------------------------------- блюда
    // Все блюда ресторана одним запросом: категории, счётчики и «Без категории» считаются на клиенте.
    getMenuItems: build.query<MenuItem[], string>({
      queryFn: async (restaurantId) => {
        const { data, error } = await supabase
          .from("menu_items")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .order("name");
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: ["MenuItem"],
    }),

    // restaurant_id подставляем явно — `with check` в БД это страхует. Валюту не пишем: она у ресторана.
    createMenuItem: build.mutation<MenuItem, { restaurantId: string; payload: DishPayload }>({
      queryFn: async ({ restaurantId, payload }) => {
        const { data, error } = await supabase
          .from("menu_items")
          .insert({ ...payload, restaurant_id: restaurantId })
          .select()
          .single();
        return error ? { error: toApiError(error) } : { data };
      },
      invalidatesTags: ["MenuItem"],
    }),

    updateMenuItem: build.mutation<MenuItem, { id: string; payload: DishPayload }>({
      queryFn: async ({ id, payload }) => {
        const { data, error } = await supabase.from("menu_items").update(payload).eq("id", id).select().single();
        return error ? { error: toApiError(error) } : { data };
      },
      invalidatesTags: ["MenuItem"],
    }),

    deleteMenuItem: build.mutation<null, string>({
      queryFn: async (id) => {
        const { error } = await supabase.from("menu_items").delete().eq("id", id);
        return error ? { error: toApiError(error) } : { data: null };
      },
      invalidatesTags: ["MenuItem"],
    }),

    // Стоп-лист должен переключаться мгновенно во время службы → оптимистично, при ошибке откат.
    setItemFlag: build.mutation<null, { restaurantId: string; id: string; flag: ItemFlag; value: boolean }>({
      queryFn: async ({ id, flag, value }) => {
        const { error } = await supabase.from("menu_items").update(flag === "is_published" ? { is_published: value } : { is_available: value }).eq("id", id);
        return error ? { error: toApiError(error) } : { data: null };
      },
      onQueryStarted: async ({ restaurantId, id, flag, value }, { dispatch, queryFulfilled }) => {
        const patch = dispatch(
          menuApi.util.updateQueryData("getMenuItems", restaurantId, (draft) => {
            const row = draft.find((r) => r.id === id);
            if (row) row[flag] = value;
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
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useRenameCategoryMutation,
  useDeleteCategoryMutation,
  useReorderCategoriesMutation,
  useGetMenuItemsQuery,
  useCreateMenuItemMutation,
  useUpdateMenuItemMutation,
  useDeleteMenuItemMutation,
  useSetItemFlagMutation,
} = menuApi;
