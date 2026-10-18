import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  MENU_BOOKING,
  MENU_FAQ,
  MENU_INFO,
  MENU_MAIN,
  MENU_MANAGER,
  MENU_MENU,
  MENU_MY,
  RATE_LIMIT_WARNING,
  TEXT_TOO_LONG,
} from "../_shared/content.ts";
import { isFlowCallback, parseBookingCallback, parseCallback, parseFlowCallback } from "../_shared/domain/callbackData.ts";
import { countsTowardRateLimit, isTooLong } from "../_shared/domain/antispam.ts";
import { checkGuestRate } from "../_shared/services/antispam.ts";
import { openConversation } from "../_shared/services/conversations.ts";
import { getFlowState } from "../_shared/services/flow.ts";
import { registerUpdate } from "../_shared/services/updates.ts";
import type { TelegramClient } from "../_shared/telegram/client.ts";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "../_shared/telegram/types.ts";
import type { HandlerContext } from "./context.ts";
import { handleFaqAnswer, handleFaqList } from "./handlers/faq.ts";
import {
  handleCancelCommand,
  handleFlowAction,
  handleFlowStart,
  handleFlowText,
  handleStaleFlowButton,
  resetFlow,
} from "./handlers/flow.ts";
import { handleBookingAction, handleMyRequests } from "./handlers/myRequests.ts";
import { handleMainMenu, handleRestaurantInfo, handleStart } from "./handlers/mainMenu.ts";
import { handleCategory, handleDish, handleMenuCategories, handleSearch } from "./handlers/menu.ts";
import { logIncoming } from "./logging.ts";

// /start и /start@bot_name (так Telegram шлёт команду в группах).
const START_COMMAND = /^\/start(@\S+)?$/i;
const CANCEL_COMMAND = /^\/cancel(@\S+)?$/i;

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
  from: { id: number; first_name: string; username?: string } | undefined,
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
  return { client: deps.client, tg: deps.tg, chatId, username: from.username ?? null, conversation };
}

/**
 * Антиспам-ворота (S06c): true — апдейт пропускаем дальше, false — обработка окончена (отброшен или предупреждён).
 * Стоит ДО записи в messages: отброшенное в БД не попадает. Диалог к этому моменту уже есть (первое сообщение
 * гостя всегда проходит лимит), так что «отброшенный» апдейт новых диалогов не плодит.
 */
async function passesRateLimit(deps: Deps, ctx: HandlerContext, counts: boolean): Promise<boolean> {
  if (!counts) return true;
  const decision = await checkGuestRate(deps.client, ctx.conversation.external_user_id);
  if (decision === "drop") return false;
  if (decision === "warn") {
    // Предупреждение — служебное, в messages не пишем (не часть диалога по существу).
    await deps.tg.sendMessage(ctx.chatId, RATE_LIMIT_WARNING);
    return false;
  }
  return true;
}

async function handleMessage(deps: Deps, message: TelegramMessage): Promise<void> {
  const ctx = await buildContext(deps, message.from, message.chat.id);
  if (!ctx) return;

  const text = message.text?.trim() ?? "";
  // Живой сценарий забирает текст себе (имя, число гостей…); иначе свободный текст — поиск блюда (S02).
  const flowState = getFlowState(ctx.conversation);

  // Шаги брони (имя, контакт, число гостей…) — быстрый легитимный ввод, в лимит частоты не идут.
  if (!(await passesRateLimit(deps, ctx, countsTowardRateLimit({ isFlowCallback: false, hasLiveFlow: !!flowState })))) return;
  if (isTooLong(text)) {
    // Текст не пишем в БД и не обрабатываем; в ответе его не цитируем.
    await deps.tg.sendMessage(ctx.chatId, TEXT_TOO_LONG);
    return;
  }

  // kind определяем до записи: текст, ушедший в поиск блюда, — шум с коротким сроком хранения (S06c).
  const isCommand = START_COMMAND.test(text) || CANCEL_COMMAND.test(text);
  await logIncoming(ctx, text, !isCommand && !flowState ? "search" : "text");

  // /start и /cancel сбрасывают сценарий в любой момент.
  if (START_COMMAND.test(text)) {
    await resetFlow(ctx);
    await handleStart(ctx);
    return;
  }
  if (CANCEL_COMMAND.test(text)) {
    await handleCancelCommand(ctx);
    return;
  }

  if (flowState) {
    await handleFlowText(ctx, flowState, text);
    return;
  }
  await handleSearch(ctx, text);
}

async function handleCallbackQuery(deps: Deps, cq: TelegramCallbackQuery): Promise<void> {
  // Подтверждаем нажатие сразу — иначе у кнопки в клиенте крутится «часики».
  await deps.tg.answerCallbackQuery(cq.id);

  const ctx = await buildContext(deps, cq.from, cq.message?.chat.id);
  if (!ctx) return;

  const data = cq.data ?? "";
  // Кнопки сценария (flow:…) в лимит не идут; нажатия меню/FAQ/категорий — идут.
  // answerCallbackQuery уже отправлен выше, поэтому у отброшенной кнопки «часики» не крутятся.
  if (!(await passesRateLimit(deps, ctx, countsTowardRateLimit({ isFlowCallback: isFlowCallback(data), hasLiveFlow: false })))) return;
  await logIncoming(ctx, `[кнопка] ${data}`, "button");

  // Кнопки сценария: flow:<draftId>:<действие>. Чужой draftId = старая сводка в чате — ничего не меняем.
  if (isFlowCallback(data)) {
    const parsedFlow = parseFlowCallback(data);
    const flowState = getFlowState(ctx.conversation);
    if (!parsedFlow || !flowState || flowState.draftId !== parsedFlow.draftId) {
      await handleStaleFlowButton(ctx, parsedFlow?.draftId ?? null, parsedFlow?.action ?? null);
      return;
    }
    await handleFlowAction(ctx, flowState, parsedFlow.action);
    return;
  }

  // Любая кнопка главного меню посреди сценария его сбрасывает; «Забронировать» и «Связаться» запускают свой.
  if (data.startsWith("menu:")) await resetFlow(ctx);

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
    case MENU_BOOKING:
      await handleFlowStart(ctx, "booking");
      return;
    case MENU_MANAGER:
      await handleFlowStart(ctx, "guest_request");
      return;
    case MENU_MY:
      await handleMyRequests(ctx);
      return;
  }

  // «Мои заявки»: bk:<id>[:действие]. Принадлежность заявки гостю проверяет сервис.
  const booking = parseBookingCallback(data);
  if (booking) {
    await handleBookingAction(ctx, booking.id, booking.action);
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
