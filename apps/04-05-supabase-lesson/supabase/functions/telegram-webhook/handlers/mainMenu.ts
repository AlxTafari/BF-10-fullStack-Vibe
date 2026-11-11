import { formatRestaurantInfo } from "../../_shared/domain/formatRestaurantInfo.ts";
import { aiWelcomeText, MAIN_MENU_KEYBOARD, MENU_PROMPT, NO_RESTAURANT_TEXT, welcomeText } from "../../_shared/content.ts";
import { getAiSettings } from "../../_shared/services/aiSettings.ts";
import { getRestaurantInfo } from "../../_shared/services/restaurantInfo.ts";
import type { HandlerContext } from "../context.ts";
import { replyNav } from "../logging.ts";

/**
 * Приветствие. AI включён у ресторана и модель настроена — представляем AI-помощника (S09 §4.18);
 * иначе прежнее приветствие: обещать AI, которого нет, нельзя.
 */
export async function handleStart(ctx: HandlerContext): Promise<void> {
  const [info, settings] = await Promise.all([
    getRestaurantInfo(ctx.client),
    getAiSettings(ctx.client, ctx.conversation.restaurant_id),
  ]);
  if (!info) {
    await replyNav(ctx, "menu", `${NO_RESTAURANT_TEXT}\n\n${MENU_PROMPT}`, MAIN_MENU_KEYBOARD);
    return;
  }
  const greeting = settings.aiEnabled && ctx.llm ? aiWelcomeText(info.name) : `${welcomeText(info.name)}\n\n${MENU_PROMPT}`;
  await replyNav(ctx, "menu", greeting, MAIN_MENU_KEYBOARD);
}

export async function handleMainMenu(ctx: HandlerContext): Promise<void> {
  await replyNav(ctx, "menu", MENU_PROMPT, MAIN_MENU_KEYBOARD);
}

export async function handleRestaurantInfo(ctx: HandlerContext): Promise<void> {
  const info = await getRestaurantInfo(ctx.client);
  await replyNav(ctx, "info", info ? formatRestaurantInfo(info) : NO_RESTAURANT_TEXT, MAIN_MENU_KEYBOARD);
}
