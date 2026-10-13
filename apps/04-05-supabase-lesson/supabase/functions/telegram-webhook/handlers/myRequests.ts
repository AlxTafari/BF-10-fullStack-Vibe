import {
  bookingCardKeyboard,
  CANCEL_CHANGE_DONE,
  CANCEL_CONFIRM_TEXT,
  CANCEL_DONE,
  CANCEL_NOT_POSSIBLE,
  cancelConfirmKeyboard,
  CHANGE_NOT_POSSIBLE,
  MY_BOOKING_NOT_FOUND,
  MY_LIST_AND_HOME_KEYBOARD,
  renderMyRequests,
} from "../../_shared/content.ts";
import type { BookingAction } from "../../_shared/domain/callbackData.ts";
import { formatBookingCard } from "../../_shared/domain/myRequests.ts";
import { startChangeFlow } from "../../_shared/services/flow.ts";
import { notifyManager } from "../../_shared/services/managerNotification.ts";
import { cancelMyBooking, getMyBooking, listMyRequests } from "../../_shared/services/myRequests.ts";
import type { HandlerContext } from "../context.ts";
import { showFlowScreen } from "./flow.ts";
import { reply } from "../logging.ts";

export async function handleMyRequests(ctx: HandlerContext): Promise<void> {
  const { bookings, requests, timeZone } = await listMyRequests(ctx.client, ctx.conversation.id);
  const { text, keyboard } = renderMyRequests(bookings, requests, timeZone);
  await reply(ctx, text, keyboard);
}

async function showCard(ctx: HandlerContext, bookingId: string): Promise<void> {
  const details = await getMyBooking(ctx.client, ctx.conversation.id, bookingId);
  // Нет такой заявки или она чужая — гостю одинаково «не найдена».
  if (!details) {
    await reply(ctx, MY_BOOKING_NOT_FOUND, MY_LIST_AND_HOME_KEYBOARD);
    return;
  }
  await reply(
    ctx,
    formatBookingCard(details.booking, details.timeZone, details.pendingChange),
    bookingCardKeyboard(details.booking.id, details.canChange, details.canCancel),
  );
}

export async function handleBookingAction(ctx: HandlerContext, bookingId: string, action: BookingAction): Promise<void> {
  switch (action) {
    case "view":
      await showCard(ctx, bookingId);
      return;

    case "x": {
      // Спрашиваем подтверждение только если отменять есть что: иначе просто показываем карточку.
      const details = await getMyBooking(ctx.client, ctx.conversation.id, bookingId);
      if (!details?.canCancel) {
        await showCard(ctx, bookingId);
        return;
      }
      await reply(ctx, CANCEL_CONFIRM_TEXT, cancelConfirmKeyboard(bookingId));
      return;
    }

    case "xy": {
      const result = await cancelMyBooking(ctx.client, ctx.conversation.id, bookingId);
      if (!result.ok) {
        // Повторный тап по «Да, отменить»: бронь уже отменена, второго уведомления менеджеру нет.
        await reply(ctx, CANCEL_NOT_POSSIBLE, MY_LIST_AND_HOME_KEYBOARD);
        return;
      }
      const isChange = result.booking.replaces_id !== null;
      try {
        await reply(ctx, isChange ? CANCEL_CHANGE_DONE : CANCEL_DONE, MY_LIST_AND_HOME_KEYBOARD);
      } finally {
        // Уведомляем всегда, даже если ответ гостю не ушёл: отмену менеджер должен увидеть.
        await notifyManager(ctx.client, (chatId, text) => ctx.tg.sendMessage(chatId, text), {
          kind: "booking_cancelled",
          request: result.booking,
          alsoCancelledChange: result.alsoCancelledChange,
        });
      }
      return;
    }

    case "ch": {
      const started = await startChangeFlow(ctx.client, ctx.conversation.id, bookingId, ctx.username);
      if (!started) {
        await reply(ctx, CHANGE_NOT_POSSIBLE, MY_LIST_AND_HOME_KEYBOARD);
        return;
      }
      await showFlowScreen(ctx, started.state.draftId, started.reply);
      return;
    }
  }
}
