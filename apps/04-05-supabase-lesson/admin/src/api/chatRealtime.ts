import { mergeConversationEvent, mergeMessageEvent, refreshConversations, refreshMessages, toConversationEventRow, toMessage } from "./chatApi";
import type { ConnectionStatus } from "./requestsRealtime";
import type { AppDispatch } from "./store";
import { supabase } from "./supabaseClient";

// Realtime чата (ADR-003): два раздельных канала.
//  1. conversations ресторана — на всё время сессии менеджера (бейдж непрочитанных нужен на любой странице);
//  2. messages ОДНОГО открытого диалога — пока открыта лента. Фильтр на уровне Realtime только по диалогу
//     (у messages нет restaurant_id), и подписка на всё заставляла бы Realtime проверять RLS-подзапрос для
//     каждого сообщения каждого гостя.
// Доступ к строкам задаёт RLS; фильтры только уменьшают трафик.

/** Токен обновился — Realtime должен получить новый, иначе подписка тихо перестанет получать события. */
function keepRealtimeAuthFresh(): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "TOKEN_REFRESHED" && session) supabase.realtime.setAuth(session.access_token);
  });
  return () => data.subscription.unsubscribe();
}

export function startConversationsRealtime(
  restaurantId: string,
  dispatch: AppDispatch,
  onStatus: (status: ConnectionStatus) => void,
): () => void {
  onStatus("connecting");
  const channel = supabase
    .channel(`conversations:${restaurantId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `restaurant_id=eq.${restaurantId}` }, (payload) => {
      if (payload.eventType === "DELETE") {
        // DELETE приходит всем подписчикам таблицы и только с id (RLS его не фильтрует): просто перечитываем список.
        refreshConversations(dispatch);
        return;
      }
      const row = toConversationEventRow(payload.new);
      if (row) mergeConversationEvent(dispatch, row);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onStatus("online");
        // События, пришедшие, пока канала не было (обрыв, а также окно между загрузкой списка и готовностью подписки),
        // потеряны безвозвратно: перечитываем первую страницу и счётчик. На первом подключении тоже.
        refreshConversations(dispatch);
      } else {
        onStatus("offline");
      }
    });
  const stopAuth = keepRealtimeAuthFresh();
  return () => {
    stopAuth();
    void supabase.removeChannel(channel);
  };
}

export function startMessagesRealtime(
  conversationId: string,
  dispatch: AppDispatch,
  onStatus: (status: ConnectionStatus) => void,
): () => void {
  onStatus("connecting");
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      const message = toMessage(payload.new);
      if (message) mergeMessageEvent(dispatch, message);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onStatus("online");
        // Свежая первая страница: закрывает окно между загрузкой ленты и готовностью подписки и дыру после обрыва.
        refreshMessages(dispatch, conversationId);
      } else {
        onStatus("offline");
      }
    });
  const stopAuth = keepRealtimeAuthFresh();
  return () => {
    stopAuth();
    void supabase.removeChannel(channel);
  };
}
