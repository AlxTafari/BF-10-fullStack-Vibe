import {
  BOOKING_SENT,
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
import { reply } from "../logging.ts";

async function showScreen(ctx: HandlerContext, draftId: string, flowReply: FlowReply): Promise<void> {
  const { text, keyboard } = renderFlowReply(draftId, flowReply);
  await reply(ctx, text, keyboard);
}

/** «📅 Забронировать» и «💬 Связаться с менеджером»: новый сценарий вместо прежнего. */
export async function handleFlowStart(ctx: HandlerContext, flow: FlowState["flow"]): Promise<void> {
  const { state, reply: flowReply } = await startFlow(ctx.client, ctx.conversation.id, flow, ctx.username);
  await showScreen(ctx, state.draftId, flowReply);
}

/** Сбрасывает сценарий, если он был. Для /start, /cancel и кнопок главного меню. */
export async function resetFlow(ctx: HandlerContext): Promise<void> {
  // state = {} — сценария нет, лишний UPDATE не нужен.
  if (Object.keys(ctx.conversation.state).length > 0) await cancelFlow(ctx.client, ctx.conversation.id);
}

export async function handleCancelCommand(ctx: HandlerContext): Promise<void> {
  await resetFlow(ctx);
  await reply(ctx, FLOW_CANCELLED, MAIN_MENU_KEYBOARD);
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
    await reply(ctx, FLOW_CANCELLED, MAIN_MENU_KEYBOARD);
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
  await showScreen(ctx, result.state.draftId, result.reply);
}

/** Гость нажал «Отправить»: создать заявку, ответить, затем уведомить менеджера. */
async function submit(ctx: HandlerContext, state: FlowState): Promise<void> {
  let result;
  try {
    result = await submitFlow(ctx.client, ctx.conversation.id, state);
  } catch (error) {
    // Вставка упала, состояние не очищено: повторное «Отправить» вернёт ту же заявку (идемпотентность).
    console.error("создание заявки не удалось:", error);
    await reply(ctx, SUBMIT_FAILED, retrySubmitKeyboard(state.draftId));
    return;
  }

  if (!result.ok) {
    // Данные перестали проходить проверку (например, час прошёл, пока гость думал): начинаем заново.
    await reply(ctx, SUBMIT_REJECTED);
    await handleFlowAction(ctx, state, "restart");
    return;
  }

  const sentText = result.kind === "booking" ? BOOKING_SENT : GUEST_REQUEST_SENT;
  try {
    // Отвечает только тот, кто первым закрыл черновик: при двойном тапе остальные обработки молчат,
    // а то гость получит серию одинаковых «заявка передана».
    if (result.claimed) await reply(ctx, sentText, MAIN_MENU_KEYBOARD);
  } finally {
    // Только для только что созданной заявки: повтор не должен слать менеджеру второе уведомление.
    // finally — чтобы сбой ответа гостю не лишил менеджера уведомления.
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
  }
}
