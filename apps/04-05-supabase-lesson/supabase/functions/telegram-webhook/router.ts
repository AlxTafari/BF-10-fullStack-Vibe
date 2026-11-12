import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MENU_BOOKING,
  MENU_FAQ,
  MENU_INFO,
  MENU_MAIN,
  MENU_MANAGER,
  MENU_MENU,
  MENU_MY,
  MANAGER_TEXT_ONLY,
  RATE_LIMIT_WARNING,
  TEXT_TOO_LONG,
} from "../_shared/content.ts";
import { isFlowCallback, parseBookingCallback, parseCallback, parseFlowCallback } from "../_shared/domain/callbackData.ts";
import { countsTowardRateLimit, isTooLong, RATE_LIMIT_WINDOW_SECONDS } from "../_shared/domain/antispam.ts";
import { isHandoffActive } from "../_shared/domain/managerChat.ts";
import type { LlmClient } from "../_shared/services/ai/agent.ts";
import { getAiSettings } from "../_shared/services/aiSettings.ts";
import { checkGuestRate } from "../_shared/services/antispam.ts";
import { openConversation } from "../_shared/services/conversations.ts";
import { getFlowState } from "../_shared/services/flow.ts";
import { registerUpdate } from "../_shared/services/updates.ts";
import type { TelegramClient } from "../_shared/telegram/client.ts";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "../_shared/telegram/types.ts";
import type { HandlerContext } from "./context.ts";
import { handleAiText } from "./handlers/ai.ts";
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
import { handleVoice } from "./handlers/voice.ts";
import { logIncoming, sendTemporary } from "./logging.ts";

// /start и /start@bot_name (так Telegram шлёт команду в группах).
const START_COMMAND = /^\/start(@\S+)?$/i;
const CANCEL_COMMAND = /^\/cancel(@\S+)?$/i;

interface Deps {
  client: SupabaseClient;
  tg: TelegramClient;
  /** Модель для агента (S09). null — Gemini не настроен: свободный текст идёт в поиск блюда, как до S09. */
  llm: LlmClient | null;
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
  chatType: string | undefined,
  callbackMessageId: number | null,
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
  return {
    client: deps.client,
    tg: deps.tg,
    chatId,
    username: from.username ?? null,
    firstName: from.first_name || null,
    conversation,
    isPrivate: chatType === "private",
    callbackMessageId,
    llm: deps.llm,
  };
}

/**
 * Антиспам-ворота (S06c): true — апдейт пропускаем дальше, false — обработка окончена (отброшен или предупреждён).
 * Стоит ДО записи в messages: отброшенное в БД не попадает. Диалог к этому моменту уже есть (первое сообщение
 * гостя всегда проходит лимит), так что «отброшенный» апдейт новых диалогов не плодит.
 */
async function passesRateLimit(deps: Deps, ctx: HandlerContext, counts: boolean): Promise<boolean> {
  if (!counts) return true;
  const decision = await checkGuestRate(deps.client, ctx.conversation.external_user_id, "text");
  if (decision === "drop") return false;
  if (decision === "warn") {
    // Предупреждение — служебное, в messages не пишем (не часть диалога по существу). Через окно лимита
    // оно теряет смысл (можно писать снова) — бот сам его удаляет.
    await sendTemporary(ctx, RATE_LIMIT_WARNING, RATE_LIMIT_WINDOW_SECONDS);
    return false;
  }
  return true;
}

async function handleMessage(deps: Deps, message: TelegramMessage): Promise<void> {
  const ctx = await buildContext(deps, message.from, message.chat.id, message.chat.type, null);
  if (!ctx) return;

  const text = message.text?.trim() ?? "";
  // Живой сценарий забирает текст себе (имя, число гостей…); не подошёл шагу — агенту с контекстом шага (S09, решает
  // handlers/flow.ts). Менеджер в диалоге (S06b) — текст только ему, бот молчит. Иначе свободный текст — агенту (S09)
  // или поиск блюда (S02).
  const flowState = getFlowState(ctx.conversation);

  // В лимит идёт только свободный текст вне сценария (агент, поиск): команды и шаги брони — легитимный быстрый ввод.
  const isCommand = START_COMMAND.test(text) || CANCEL_COMMAND.test(text);
  if (!(await passesRateLimit(deps, ctx, countsTowardRateLimit({ isCommand, isCallback: false, hasLiveFlow: !!flowState })))) return;

  // Голосовое (S09, сессия 4) — свой путь: агенту, менеджеру или отказ решает handlers/voice.ts. В лимит идёт
  // как свободный текст (проверка выше): у голосового text нет, isCommand = false.
  if (message.voice) {
    await handleVoice(ctx, message.voice, flowState);
    return;
  }
  if (isTooLong(text)) {
    // Текст не пишем в БД и не обрабатываем; в ответе его не цитируем.
    await deps.tg.sendMessage(ctx.chatId, TEXT_TOO_LONG);
    return;
  }

  // Ручной режим (S06b) — только для свободного текста: команды работают как обычно, а сценарий, который гость сам
  // начал кнопкой во время режима, ведёт бот (при подключении менеджера прежний сценарий сбрасывается в RPC).
  const toManager = !isCommand && !flowState && isHandoffActive(ctx.conversation.handoff_until, new Date());
  if (toManager) {
    // Стикер или фото менеджер в админке не увидит (журнал хранит текст и голосовые) — говорим об этом гостю.
    if (!text) {
      await deps.tg.sendMessage(ctx.chatId, MANAGER_TEXT_ONLY);
      return;
    }
    // 'text', а не 'search': это разговор по существу — превью, непрочитанные и окно агента после возврата.
    await logIncoming(ctx, text, "text");
    return;
  }

  // Свободный текст вне сценария: AI ресторана включён и модель настроена — агенту, иначе поиск блюда (до S09).
  // Пустой текст (стикер, фото) агенту не отдаём: поиск ответит подсказкой. Настройки читаем только здесь —
  // команды и шаги сценария лишнего запроса не делают.
  const isFreeText = !isCommand && !flowState;
  const aiSettings = isFreeText && text && deps.llm ? await getAiSettings(deps.client, ctx.conversation.restaurant_id) : null;
  const toAgent = aiSettings?.aiEnabled === true;

  // kind определяем до записи: текст, ушедший в поиск блюда, — шум с коротким сроком хранения (S06c).
  // Реплика агенту — разговор по существу ('text'): её видит окно истории агента и превью в админке.
  await logIncoming(ctx, text, isFreeText && !toAgent ? "search" : "text");

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
  if (toAgent && aiSettings) {
    await handleAiText(ctx, aiSettings);
    return;
  }
  await handleSearch(ctx, text);
}

async function handleCallbackQuery(deps: Deps, cq: TelegramCallbackQuery): Promise<void> {
  // Широкий лимит нажатий (S07, своё окно bucket = 'button') — до ответа на нажатие: при превышении ответ сам несёт
  // предупреждение всплывашкой, в чат ничего не пишется и удалять потом нечего. До buildContext и записи в messages:
  // отброшенное нажатие в БД не попадает. Сбой счётчика пропускает нажатие (fail open, S06c).
  const decision = await checkGuestRate(deps.client, cq.from.id, "button");
  // Ответ на нажатие — всегда, иначе у кнопки в клиенте крутятся «часики» до таймаута Telegram.
  await deps.tg.answerCallbackQuery(cq.id, decision === "warn" ? RATE_LIMIT_WARNING : undefined);
  if (decision !== "allowed") return;

  const ctx = await buildContext(deps, cq.from, cq.message?.chat.id, cq.message?.chat.type, cq.message?.message_id ?? null);
  if (!ctx) return;

  const data = cq.data ?? "";
  // Нажатия — навигация: в текстовый лимит не идут (см. countsTowardRateLimit), только в окно кнопок выше.
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
