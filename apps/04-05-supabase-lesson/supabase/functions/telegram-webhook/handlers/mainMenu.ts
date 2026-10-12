import { formatRestaurantInfo } from "../../_shared/domain/formatRestaurantInfo.ts";
import { FREE_TEXT_HINT, MAIN_MENU_KEYBOARD, MENU_PROMPT, NO_RESTAURANT_TEXT, SECTION_STUB, welcomeText } from "../../_shared/content.ts";
import { getRestaurantInfo } from "../../_shared/services/restaurantInfo.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function handleStart(ctx: HandlerContext): Promise<void> {
  const info = await getRestaurantInfo(ctx.client);
  const greeting = info ? welcomeText(info.name) : NO_RESTAURANT_TEXT;
  await reply(ctx, `${greeting}\n\n${MENU_PROMPT}`, MAIN_MENU_KEYBOARD);
}

export async function handleFreeText(ctx: HandlerContext): Promise<void> {
  await reply(ctx, FREE_TEXT_HINT, MAIN_MENU_KEYBOARD);
}

export async function handleRestaurantInfo(ctx: HandlerContext): Promise<void> {
  const info = await getRestaurantInfo(ctx.client);
  await reply(ctx, info ? formatRestaurantInfo(info) : NO_RESTAURANT_TEXT, MAIN_MENU_KEYBOARD);
}

export async function handleSectionStub(ctx: HandlerContext): Promise<void> {
  await reply(ctx, SECTION_STUB, MAIN_MENU_KEYBOARD);
}
