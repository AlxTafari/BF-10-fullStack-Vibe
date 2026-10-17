import {
  type BookingRequest,
  type GuestRequest,
  mergeBookingEvent,
  mergeGuestRequestEvent,
  pendingChangeTag,
  requestsApi,
} from "./requestsApi";
import type { AppDispatch } from "./store";
import { supabase } from "./supabaseClient";

// Realtime (ADR-003): один канал на сессию менеджера, две подписки postgres_changes. Доступ к строкам задаёт RLS
// (проверено в tests/realtime.integration.test.ts), фильтр restaurant_id= только уменьшает трафик.
// DELETE RLS не фильтрует и приходит с одним id; заявки не удаляются, но каскад при удалении ресторана их порождает.

export type ConnectionStatus = "connecting" | "online" | "offline";

export interface RequestsRealtimeHandlers {
  onStatus: (status: ConnectionStatus) => void;
  /** Новая заявка (INSERT). Не вызывается для первичной загрузки и для собственных действий (они приходят как UPDATE). */
  onNewBooking: (row: BookingRequest) => void;
  onNewGuestRequest: (row: GuestRequest) => void;
}

const hasRowShape = (value: unknown): value is { id: string; updated_at: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { id?: unknown }).id === "string" &&
  typeof (value as { updated_at?: unknown }).updated_at === "string";

/**
 * Открывает канал и вливает события в кэш RTK Query. Возвращает функцию закрытия — вызывать при выходе,
 * смене ресторана и размонтировании: висящих каналов быть не должно (supabase.getChannels()).
 */
export function startRequestsRealtime(
  restaurantId: string,
  dispatch: AppDispatch,
  getState: () => unknown,
  handlers: RequestsRealtimeHandlers,
): () => void {
  const filter = `restaurant_id=eq.${restaurantId}`;
  handlers.onStatus("connecting");

  const channel = supabase
    .channel(`requests:${restaurantId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "booking_requests", filter }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as { id?: string }).id;
        if (id) mergeBookingEvent(dispatch, getState, { type: "DELETE", id });
      } else if (hasRowShape(payload.new)) {
        const row = payload.new as BookingRequest;
        mergeBookingEvent(dispatch, getState, { type: payload.eventType, row });
        dispatch(requestsApi.util.invalidateTags(["OpenCounts", "ConversationRequests"]));
        // Карточка исходной брони показывает её ожидающее изменение — оно могло появиться или закрыться.
        if (row.replaces_id) {
          dispatch(requestsApi.util.invalidateTags([{ type: "Booking", id: pendingChangeTag(row.replaces_id) }]));
        }
        if (payload.eventType === "INSERT") handlers.onNewBooking(row);
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "guest_requests", filter }, (payload) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as { id?: string }).id;
        if (id) mergeGuestRequestEvent(dispatch, getState, { type: "DELETE", id });
      } else if (hasRowShape(payload.new)) {
        const row = payload.new as GuestRequest;
        mergeGuestRequestEvent(dispatch, getState, { type: payload.eventType, row });
        dispatch(requestsApi.util.invalidateTags(["OpenCounts", "ConversationRequests"]));
        if (payload.eventType === "INSERT") handlers.onNewGuestRequest(row);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        handlers.onStatus("online");
        // События, пришедшие, пока канала не было (обрыв, а также окно между загрузкой списка и готовностью
        // подписки), потеряны безвозвратно — перечитываем всё. На первом подключении тоже: список обычно
        // загружается раньше, чем подписка успевает стать SUBSCRIBED.
        dispatch(
          requestsApi.util.invalidateTags(["BookingList", "GuestRequestList", "Booking", "GuestRequest", "OpenCounts", "ConversationRequests"]),
        );
      } else {
        // CHANNEL_ERROR / TIMED_OUT / CLOSED. supabase-js переподключается сам; вернётся SUBSCRIBED — перечитаем.
        handlers.onStatus("offline");
      }
    });

  // Токен обновился — Realtime должен получить новый, иначе подписка тихо перестанет получать события.
  // (supabase-js делает это сам; явная передача — страховка, колбэк синхронный.)
  const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "TOKEN_REFRESHED" && session) supabase.realtime.setAuth(session.access_token);
  });

  return () => {
    authSub.subscription.unsubscribe();
    void supabase.removeChannel(channel);
  };
}
