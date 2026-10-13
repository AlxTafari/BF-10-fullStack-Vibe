import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { MenuCategoryRow, MenuItemRow, MenuItemWithCategory } from "../types.ts";

// Явный список колонок вместо select(*): внутренние поля (external_id, source, restaurant_id…) гостю не нужны.
// Валюты здесь нет: она свойство ресторана (restaurants.currency), сервис подставляет её сам.
const ITEM_COLUMNS =
  "id, category_id, name, description, price, ingredients, allergens, portion_grams, " +
  "kcal_per_portion, protein_per_portion, fat_per_portion, carbs_per_portion, is_available";

/** Категории, в которых есть хотя бы одно опубликованное блюдо (!inner отбрасывает пустые). */
export async function listCategoriesWithPublishedItems(
  client: SupabaseClient,
  restaurantId: string,
): Promise<MenuCategoryRow[]> {
  const { data, error } = await client
    .from("menu_categories")
    .select("id, name, menu_items!inner(id)")
    .eq("restaurant_id", restaurantId)
    .eq("menu_items.is_published", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(({ id, name }) => ({ id, name }));
}

interface ListItemsFilter {
  categoryId?: string;
  /** Готовый шаблон для ilike (спецсимволы уже экранированы доменом). */
  namePattern?: string;
  limit: number;
}

/** Опубликованные блюда ресторана. Неопубликованные не возвращаются никогда — фильтр здесь, а не в обработчике. */
export async function listPublishedItems(
  client: SupabaseClient,
  restaurantId: string,
  filter: ListItemsFilter,
): Promise<MenuItemRow[]> {
  let query = client
    .from("menu_items")
    .select(ITEM_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .eq("is_published", true);
  if (filter.categoryId) query = query.eq("category_id", filter.categoryId);
  if (filter.namePattern) query = query.ilike("name", filter.namePattern);
  const { data, error } = await query.order("name", { ascending: true }).limit(filter.limit);
  if (error) throw error;
  return (data ?? []) as unknown as MenuItemRow[];
}

export async function getPublishedItem(
  client: SupabaseClient,
  restaurantId: string,
  itemId: string,
): Promise<MenuItemWithCategory | null> {
  const { data, error } = await client
    .from("menu_items")
    .select(`${ITEM_COLUMNS}, category:menu_categories(name)`)
    .eq("restaurant_id", restaurantId)
    .eq("is_published", true)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { category, ...item } = data as unknown as MenuItemRow & { category: { name: string } | null };
  return { ...item, category_name: category?.name ?? null };
}
