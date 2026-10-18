import { formatRestaurantInfo } from "../../_shared/domain/formatRestaurantInfo.ts";
import { MAIN_MENU_KEYBOARD, MENU_PROMPT, NO_RESTAURANT_TEXT, welcomeText } from "../../_shared/content.ts";
import { getRestaurantInfo } from "../../_shared/services/restaurantInfo.ts";
import type { HandlerContext } from "../context.ts";
import { replyNav } from "../logging.ts";

export async function handleStart(ctx: HandlerContext): Promise<void> {
  const info = await getRestaurantInfo(ctx.client);
  const greeting = info ? welcomeText(info.name) : NO_RESTAURANT_TEXT;
  await replyNav(ctx, "menu", `${greeting}\n\n${MENU_PROMPT}`, MAIN_MENU_KEYBOARD);
}

export async function handleMainMenu(ctx: HandlerContext): Promise<void> {
  await replyNav(ctx, "menu", MENU_PROMPT, MAIN_MENU_KEYBOARD);
}

export async function handleRestaurantInfo(ctx: HandlerContext): Promise<void> {
  const info = await getRestaurantInfo(ctx.client);
  await replyNav(ctx, "info", info ? formatRestaurantInfo(info) : NO_RESTAURANT_TEXT, MAIN_MENU_KEYBOARD);
}
