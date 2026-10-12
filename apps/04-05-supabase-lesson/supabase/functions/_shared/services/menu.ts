import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { DishCardData } from "../domain/formatDishCard.ts";
import { normalizeSearchQuery, toLikePattern } from "../domain/searchQuery.ts";
import { getPublishedItem, listCategoriesWithPublishedItems, listPublishedItems } from "../repositories/menuRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { MenuCategoryRow } from "../types.ts";

/** Сколько блюд показываем в результатах текстового поиска; больше — просим уточнить запрос. */
export const SEARCH_LIMIT = 8;
/** Блюда одной категории показываем целиком, но не бесконечно (лимит кнопок Telegram — 100). */
export const CATEGORY_ITEMS_LIMIT = 30;

export interface DishSummary {
  id: string;
  name: string;
  price: number;
  currency: string;
  isAvailable: boolean;
}

export type SearchMenuResult =
  | { ok: true; items: DishSummary[]; hasMore: boolean }
  | { ok: false; reason: "invalid_query" };

export interface DishDetails {
  card: DishCardData;
  categoryId: string | null;
  categoryName: string | null;
}

export async function listMenuCategories(client: SupabaseClient): Promise<MenuCategoryRow[]> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) return [];
  return listCategoriesWithPublishedItems(client, restaurant.id);
}

/**
 * Поиск по названию и/или список блюд категории. Без `query` и `categoryId` искать нечего.
 * Невалидный запрос — не исключение, а `invalid_query`: это нормальный ввод гостя.
 * maxPrice (MVP-план §5) не реализуем — подбор по бюджету это S09.
 */
export async function searchMenu(
  client: SupabaseClient,
  input: { query?: string; categoryId?: string },
): Promise<SearchMenuResult> {
  let namePattern: string | undefined;
  if (input.query !== undefined) {
    const query = normalizeSearchQuery(input.query);
    if (query === null) return { ok: false, reason: "invalid_query" };
    namePattern = toLikePattern(query);
  } else if (!input.categoryId) {
    return { ok: false, reason: "invalid_query" };
  }

  const restaurant = await getRestaurant(client);
  if (!restaurant) return { ok: true, items: [], hasMore: false };

  const limit = namePattern ? SEARCH_LIMIT : CATEGORY_ITEMS_LIMIT;
  // limit + 1: лишняя строка говорит, что результатов больше, чем показываем.
  const rows = await listPublishedItems(client, restaurant.id, {
    categoryId: input.categoryId,
    namePattern,
    limit: limit + 1,
  });
  return {
    ok: true,
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map((r) => ({
      id: r.id,
      name: r.name,
      price: r.price,
      currency: r.currency,
      isAvailable: r.is_available,
    })),
  };
}

/** Неопубликованное блюдо = null, как несуществующее. */
export async function getDishDetails(client: SupabaseClient, input: { dishId: string }): Promise<DishDetails | null> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) return null;
  const item = await getPublishedItem(client, restaurant.id, input.dishId);
  if (!item) return null;
  const { category_id, category_name, id: _id, ...card } = item;
  return { card, categoryId: category_id, categoryName: category_name };
}
