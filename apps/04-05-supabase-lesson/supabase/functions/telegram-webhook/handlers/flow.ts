import {
  BOOKING_SENT,
  CHANGE_REJECTED,
  CHANGE_SENT,
  FLOW_CANCELLED,
  FLOW_STALE,
  GUEST_REQUEST_SENT,
  MAIN_MENU_KEYBOARD,
  renderFlowReply,
  retrySubmitKeyboard,
  SUBMIT_FAILED,
  SUBMIT_REJECTED,
} from "../../_shared/content.ts";
import type { FlowInput, FlowReply, FlowState } from "../../_shared/domain/flowState.ts";
import { cancelFlow, continueFlow, isDraftSubmitted, startFlow, submitFlow } from "../../_shared/services/flow.ts";
import { notifyManager } from "../../_shared/services/managerNotification.ts";
import type { HandlerContext } from "../context.ts";
import { reply, replyNav } from "../logging.ts";

/**
 * Экран сценария. Все шаги одного черновика перерисовывают одно и то же сообщение (replyNav, экран `flow:<draftId>`),
 * а не плодят новое на каждый шаг; новый черновик (или «Забронировать» из меню) — новое сообщение.
 */
export async function showFlowScreen(ctx: HandlerContext, draftId: string, flowReply: FlowReply): Promise<void> {
  const { text, keyboard } = renderFlowReply(draftId, flowReply);
  await replyNav(ctx, `flow:${draftId}`, text, keyboard);
}

/** «📅 Забронировать» и «💬 Связаться с менеджером»: новый сценарий вместо прежнего. */
export async function handleFlowStart(ctx: HandlerContext, flow: FlowState["flow"]): Promise<void> {
  const { state, reply: flowReply } = await startFlow(ctx.client, ctx.conversation.id, flow, ctx.username);
  await showFlowScreen(ctx, state.draftId, flowReply);
}

/** Сбрасывает сценарий, если он был. Для /start, /cancel и кнопок главного меню. */
export async function resetFlow(ctx: HandlerContext): Promise<void> {
  // state = {} — сценария нет, лишний UPDATE не нужен.
  if (Object.keys(ctx.conversation.state).length > 0) await cancelFlow(ctx.client, ctx.conversation.id);
}

export async function handleCancelCommand(ctx: HandlerContext): Promise<void> {
  // draftId берём до сброса: «Отменено» заменяет собой сообщение сценария, а не висит под ним.
  const draftId = ctx.conversation.state.draftId;
  await resetFlow(ctx);
  if (typeof draftId === "string") await replyNav(ctx, `flow:${draftId}`, FLOW_CANCELLED, MAIN_MENU_KEYBOARD);
  else await reply(ctx, FLOW_CANCELLED, MAIN_MENU_KEYBOARD);
}

/**
 * Кнопка старой сводки или сценарий уже закрыт/истёк: ничего не меняем.
 * «Отправить» по уже отправленной заявке — тишина: ответ «заявка передана» гость уже получил.
 */
export async function handleStaleFlowButton(ctx: HandlerContext, draftId: string | null, action: string | null): Promise<void> {
  if (draftId && action === "send" && (await isDraftSubmitted(ctx.client, ctx.conversation.id, draftId))) return;
  await reply(ctx, FLOW_STALE, MAIN_MENU_KEYBOARD);
}

export async function handleFlowText(ctx: HandlerContext, state: FlowState, text: string): Promise<void> {
  await advance(ctx, state, { type: "text", text });
}

export async function handleFlowAction(ctx: HandlerContext, state: FlowState, action: string): Promise<void> {
  if (action === "cancel") {
    await cancelFlow(ctx.client, ctx.conversation.id);
    await replyNav(ctx, `flow:${state.draftId}`, FLOW_CANCELLED, MAIN_MENU_KEYBOARD);
    return;
  }
  await advance(ctx, state, { type: "action", action });
}

async function advance(ctx: HandlerContext, state: FlowState, input: FlowInput): Promise<void> {
  const result = await continueFlow(ctx.client, ctx.conversation.id, state, input, ctx.username);
  if (result.reply.screen.screen === "submit") {
    await submit(ctx, result.state);
    return;
  }
  await showFlowScreen(ctx, result.state.draftId, result.reply);
}

/** Гость нажал «Отправить»: создать заявку, ответить, затем уведомить менеджера. */
async function submit(ctx: HandlerContext, state: FlowState): Promise<void> {
  let result;
  try {
    result = await submitFlow(ctx.client, ctx.conversation.id, state);
  } catch (error) {
    // Вставка упала, состояние не очищено: повторное «Отправить» вернёт ту же заявку (идемпотентность).
    console.error("создание заявки не удалось:", error);
    await replyNav(ctx, `flow:${state.draftId}`, SUBMIT_FAILED, retrySubmitKeyboard(state.draftId));
    return;
  }

  if (!result.ok && "replaces" in result.errors) {
    // Исходную бронь уже нельзя менять (отменена, прошла, изменение уже запрошено): сценарий закрываем.
    await cancelFlow(ctx.client, ctx.conversation.id);
    await replyNav(ctx, `flow:${state.draftId}`, CHANGE_REJECTED, MAIN_MENU_KEYBOARD, true);
    return;
  }

  if (!result.ok) {
    // Данные перестали проходить проверку (например, час прошёл, пока гость думал): начинаем заново.
    await reply(ctx, SUBMIT_REJECTED);
    await handleFlowAction(ctx, state, "restart");
    return;
  }

  const sentText = result.kind === "guest_request"
    ? GUEST_REQUEST_SENT
    : result.request.replaces_id
    ? CHANGE_SENT
    : BOOKING_SENT;
  // Менеджера уведомляем ПЕРВЫМ: итог для гостя должен оказаться в чате самым нижним (с кнопками под рукой), а не
  // уехать вверх под уведомление (так бывает, когда менеджер и гость — один чат). notifyManager не бросает.
  // Только для только что созданной заявки: повтор не должен слать менеджеру второе уведомление.
  if (result.created) {
    const send = (chatId: number, text: string) => ctx.tg.sendMessage(chatId, text);
    await notifyManager(
      ctx.client,
      send,
      result.kind === "booking"
        ? { kind: "booking", request: result.request }
        : { kind: "guest_request", request: result.request },
    );
  }
  // Отвечает только тот, кто первым закрыл черновик: при двойном тапе остальные обработки молчат,
  // а то гость получит серию одинаковых «заявка передана». Итог рисуется заново внизу, сводка удаляется.
  if (result.claimed) await replyNav(ctx, `flow:${state.draftId}`, sentText, MAIN_MENU_KEYBOARD, true);
}
