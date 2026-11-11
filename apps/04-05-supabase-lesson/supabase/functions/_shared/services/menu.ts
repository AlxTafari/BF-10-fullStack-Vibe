import type { SupabaseClient } from "@supabase/supabase-js";
import { type AllergenCode, partitionByAllergens } from "../domain/allergens.ts";
import type { DishCardData } from "../domain/formatDishCard.ts";
import { normalizeSearchQuery, toLikePattern } from "../domain/searchQuery.ts";
import { getPublishedItem, listCategoriesWithPublishedItems, listPublishedItems } from "../repositories/menuRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { MenuCategoryRow } from "../types.ts";

/** Сколько блюд показываем в результатах текстового поиска; больше — просим уточнить запрос. */
export const SEARCH_LIMIT = 8;
/** Блюда одной категории: больше 10 кнопок в чате уже неудобно; превышение — подсказка про поиск. */
export const CATEGORY_ITEMS_LIMIT = 10;
/** Подбор по аллергенам просматривает меню целиком; предел — страховка от гигантского меню, не пагинация. */
export const ALLERGEN_SCAN_LIMIT = 300;

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
      currency: restaurant.currency,
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
  return { card: { ...card, currency: restaurant.currency }, categoryId: category_id, categoryName: category_name };
}

export interface AllergenFilterResult {
  /** Состав указан, названных аллергенов нет. */
  free: DishSummary[];
  /** Содержит хотя бы один из названных. */
  contains: DishSummary[];
  /** Состав не указан — безопасным не называем. */
  unknown: DishSummary[];
  /** Меню больше ALLERGEN_SCAN_LIMIT: просмотрено не всё. */
  truncated: boolean;
}

/**
 * Опубликованные блюда (всего меню или категории), поделённые по аллергенам гостя (S09). Деление —
 * детерминированное, в domain; AI только пересказывает группы. Сервис ядра: про AI не знает, недоступные
 * сейчас блюда возвращает с isAvailable = false, как searchMenu.
 */
export async function filterMenuByAllergens(
  client: SupabaseClient,
  input: { allergens: AllergenCode[]; categoryId?: string },
): Promise<AllergenFilterResult> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) return { free: [], contains: [], unknown: [], truncated: false };
  const rows = await listPublishedItems(client, restaurant.id, {
    categoryId: input.categoryId,
    limit: ALLERGEN_SCAN_LIMIT + 1,
  });
  const scanned = rows.slice(0, ALLERGEN_SCAN_LIMIT);
  const groups = partitionByAllergens(scanned, input.allergens);
  const toSummary = (r: (typeof scanned)[number]): DishSummary => ({
    id: r.id,
    name: r.name,
    price: r.price,
    currency: restaurant.currency,
    isAvailable: r.is_available,
  });
  return {
    free: groups.free.map(toSummary),
    contains: groups.contains.map(toSummary),
    unknown: groups.unknown.map(toSummary),
    truncated: rows.length > ALLERGEN_SCAN_LIMIT,
  };
}
