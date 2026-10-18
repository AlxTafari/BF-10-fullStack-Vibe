import {
  BACK_TO_CATEGORIES,
  BACK_TO_MENU,
  CATEGORY_TRUNCATED,
  categoriesKeyboard,
  categoryPrompt,
  DISH_NOT_FOUND,
  dishCardKeyboard,
  dishListKeyboard,
  MENU_AND_HOME_KEYBOARD,
  MENU_CATEGORIES_PROMPT,
  MENU_EMPTY,
  HOME_KEYBOARD,
  SEARCH_CHOOSE,
  SEARCH_HINT,
  SEARCH_NOT_FOUND,
  SEARCH_TOO_MANY,
} from "../../_shared/content.ts";
import { formatDishCard } from "../../_shared/domain/formatDishCard.ts";
import type { MessageKind } from "../../_shared/types.ts";
import { getDishDetails, listMenuCategories, searchMenu } from "../../_shared/services/menu.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function handleMenuCategories(ctx: HandlerContext): Promise<void> {
  const categories = await listMenuCategories(ctx.client);
  if (categories.length === 0) {
    await reply(ctx, MENU_EMPTY, HOME_KEYBOARD);
    return;
  }
  await reply(ctx, MENU_CATEGORIES_PROMPT, categoriesKeyboard(categories));
}

export async function handleCategory(ctx: HandlerContext, categoryId: string): Promise<void> {
  const [categories, result] = await Promise.all([
    listMenuCategories(ctx.client),
    searchMenu(ctx.client, { categoryId }),
  ]);
  const category = categories.find((c) => c.id === categoryId);
  // Категории нет в списке (скрыта/не существует/подделанный id) или в ней нет блюд.
  if (!category || !result.ok || result.items.length === 0) {
    await handleMenuCategories(ctx);
    return;
  }
  const prompt = categoryPrompt(category.name);
  await reply(ctx, result.hasMore ? `${prompt}\n${CATEGORY_TRUNCATED}` : prompt, dishListKeyboard(result.items, BACK_TO_CATEGORIES));
}

/** kind = 'search', когда карточку показываем как ответ на поисковый запрос (handleSearch); по кнопке — 'text'. */
export async function handleDish(ctx: HandlerContext, dishId: string, kind: MessageKind = "text"): Promise<void> {
  const dish = await getDishDetails(ctx.client, { dishId });
  if (!dish) {
    await reply(ctx, DISH_NOT_FOUND, MENU_AND_HOME_KEYBOARD, kind);
    return;
  }
  const category = dish.categoryId ? { id: dish.categoryId, name: dish.categoryName } : null;
  await reply(ctx, formatDishCard(dish.card), dishCardKeyboard(category), kind);
}

/**
 * Свободный текст гостя = поиск блюда по названию (S02). Все ответы бота здесь пишутся как kind = 'search':
 * запрос гостя (router) и ответ на него — шум с коротким сроком хранения (S06c).
 */
export async function handleSearch(ctx: HandlerContext, text: string): Promise<void> {
  const result = await searchMenu(ctx.client, { query: text });
  if (!result.ok) {
    await reply(ctx, SEARCH_HINT, MENU_AND_HOME_KEYBOARD, "search");
    return;
  }
  if (result.items.length === 0) {
    await reply(ctx, SEARCH_NOT_FOUND, MENU_AND_HOME_KEYBOARD, "search");
    return;
  }
  if (result.items.length === 1) {
    await handleDish(ctx, result.items[0].id, "search");
    return;
  }
  const prompt = result.hasMore ? SEARCH_TOO_MANY : SEARCH_CHOOSE;
  await reply(ctx, prompt, dishListKeyboard(result.items, BACK_TO_MENU), "search");
}
