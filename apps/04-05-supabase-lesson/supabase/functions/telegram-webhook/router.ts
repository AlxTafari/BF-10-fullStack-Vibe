import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { MENU_BOOKING, MENU_FAQ, MENU_INFO, MENU_MANAGER, MENU_MENU } from "../_shared/content.ts";
import { openConversation } from "../_shared/services/conversations.ts";
import { registerUpdate } from "../_shared/services/updates.ts";
import type { TelegramClient } from "../_shared/telegram/client.ts";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "../_shared/telegram/types.ts";
import type { HandlerContext } from "./context.ts";
import { handleFreeText, handleRestaurantInfo, handleSectionStub, handleStart } from "./handlers/mainMenu.ts";
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
  await handleFreeText(ctx);
}

async function handleCallbackQuery(deps: Deps, cq: TelegramCallbackQuery): Promise<void> {
  // Подтверждаем нажатие сразу — иначе у кнопки в клиенте крутится «часики».
  await deps.tg.answerCallbackQuery(cq.id);

  const ctx = await buildContext(deps, cq.from, cq.message?.chat.id);
  if (!ctx) return;

  const data = cq.data ?? "";
  await logIncoming(ctx, `[кнопка] ${data}`);

  switch (data) {
    case MENU_INFO:
      await handleRestaurantInfo(ctx);
      return;
    // Меню, FAQ — S02; бронь и обращения — S03.
    case MENU_MENU:
    case MENU_FAQ:
    case MENU_BOOKING:
    case MENU_MANAGER:
      await handleSectionStub(ctx);
      return;
    default:
      return;
  }
}
