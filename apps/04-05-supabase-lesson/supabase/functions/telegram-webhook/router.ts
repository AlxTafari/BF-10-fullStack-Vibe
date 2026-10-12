import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { MENU_BOOKING, MENU_FAQ, MENU_INFO, MENU_MAIN, MENU_MANAGER, MENU_MENU } from "../_shared/content.ts";
import { parseCallback } from "../_shared/domain/callbackData.ts";
import { openConversation } from "../_shared/services/conversations.ts";
import { registerUpdate } from "../_shared/services/updates.ts";
import type { TelegramClient } from "../_shared/telegram/client.ts";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "../_shared/telegram/types.ts";
import type { HandlerContext } from "./context.ts";
import { handleFaqAnswer, handleFaqList } from "./handlers/faq.ts";
import { handleMainMenu, handleRestaurantInfo, handleSectionStub, handleStart } from "./handlers/mainMenu.ts";
import { handleCategory, handleDish, handleMenuCategories, handleSearch } from "./handlers/menu.ts";
import { logIncoming } from "./logging.ts";

// /start и /start@bot_name (так Telegram шлёт команду в группах).
const START_COMMAND = /^\/start(@\S+)?$/i;

interface Deps {
  client: SupabaseClient;
  tg: TelegramClient;
}

export async function routeUpdate(deps: Deps, update: TelegramUpdate): Promise<void> {
  // Повторная доставка того же апдейта (ADR-006) — выходим, ничего не дублируя.
  const isNew = await registerUpdate(deps.client, update.update_id);
  if (!isNew) return;

  if (update.message) {
    await handleMessage(deps, update.message);
  } else if (update.callback_query) {
    await handleCallbackQuery(deps, update.callback_query);
  }
}

/** Находит/создаёт диалог гостя и собирает контекст обработчиков. null — нечего обрабатывать. */
async function buildContext(
  deps: Deps,
  from: { id: number; first_name: string } | undefined,
  chatId: number | undefined,
): Promise<HandlerContext | null> {
  if (!from || chatId === undefined) return null;
  const conversation = await openConversation(deps.client, {
    externalUserId: from.id,
    chatId,
    displayName: from.first_name,
  });
  if (!conversation) {
    console.error("restaurants пуст — запусти seed / заполни ресторан");
    return null;
  }
  return { client: deps.client, tg: deps.tg, chatId, conversation };
}

async function handleMessage(deps: Deps, message: TelegramMessage): Promise<void> {
  const ctx = await buildContext(deps, message.from, message.chat.id);
  if (!ctx) return;

  const text = message.text?.trim() ?? "";
  await logIncoming(ctx, text);

  if (START_COMMAND.test(text)) {
    await handleStart(ctx);
    return;
  }
  // Свободный текст — поиск блюда по названию (S02). В S03 перед ним встанет проверка активного сценария.
  await handleSearch(ctx, text);
}

async function handleCallbackQuery(deps: Deps, cq: TelegramCallbackQuery): Promise<void> {
  // Подтверждаем нажатие сразу — иначе у кнопки в клиенте крутится «часики».
  await deps.tg.answerCallbackQuery(cq.id);

  const ctx = await buildContext(deps, cq.from, cq.message?.chat.id);
  if (!ctx) return;

  const data = cq.data ?? "";
  await logIncoming(ctx, `[кнопка] ${data}`);

  switch (data) {
    case MENU_MAIN:
      await handleMainMenu(ctx);
      return;
    case MENU_INFO:
      await handleRestaurantInfo(ctx);
      return;
    case MENU_MENU:
      await handleMenuCategories(ctx);
      return;
    case MENU_FAQ:
      await handleFaqList(ctx);
      return;
    // Бронь и обращения — S03.
    case MENU_BOOKING:
    case MENU_MANAGER:
      await handleSectionStub(ctx);
      return;
  }

  // Кнопки с id (faq:/cat:/dish:). Битое или подделанное значение — тихо в главное меню.
  const parsed = parseCallback(data);
  switch (parsed?.kind) {
    case "faq":
      await handleFaqAnswer(ctx, parsed.id);
      return;
    case "category":
      await handleCategory(ctx, parsed.id);
      return;
    case "dish":
      await handleDish(ctx, parsed.id);
      return;
    default:
      await handleMainMenu(ctx);
  }
}
