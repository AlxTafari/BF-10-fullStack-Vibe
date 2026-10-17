import { type ConversationEventRow, type ConversationRow, applyConversationEvent, keyOfConversation, toEventRow } from "@/domain/conversations";
import { type Cursor, type Page, PAGE_SIZE, buildPage, mergeFreshPage, mergePage } from "@/domain/cursor";
import { type Message, applyMessageEvent, keyOfMessage } from "@/domain/messages";
import { baseApi } from "./baseApi";
import { toConversationEventRow, toConversationRow, toMessage } from "./chatMappers";
import { toApiError } from "./errors";
import type { AppDispatch, RootState } from "./store";
import { supabase } from "./supabaseClient";

// Кэш RTK Query — плоский список + курсор (ADR-005, вопрос 5 спеки S06): ключ кэша НЕ включает курсор, `merge`
// дописывает страницу в общий список. Встроенный infiniteQuery хранит страницы по отдельности, а события Realtime
// вставляются в произвольное место списка — с ним пришлось бы искать нужную страницу и пересчитывать границы.
// Первую страницу (cursor = null) запрашивает хук, следующие — loadOlderMessages / loadMoreConversations
// (императивно, `forceRefetch`), чтобы курсор брался из кэша, а не из локального состояния компонента.

export interface MessagesArgs {
  conversationId: string;
  cursor: Cursor | null;
}
export interface ConversationsArgs {
  cursor: Cursor | null;
}

/** Шапка ленты: то же, что приходит событием Realtime (диалог без сообщений тоже можно открыть по ссылке). */
export type ConversationHeader = ConversationEventRow;

export interface GuestRequestsOfConversation {
  bookings: { id: string; booking_at: string; status: string; guests_count: number; replaces_id: string | null }[];
  guestRequests: { id: string; kind: string; status: string; created_at: string }[];
}

/** Сгенерированные типы RPC не знают, что курсор первой страницы — null; SQL-функции это допускают. */
const cursorArg = (value: string | undefined): string => (value ?? null) as string;

const PANEL_LIMIT = 10;

export const chatApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getConversations: build.query<Page<ConversationRow>, ConversationsArgs>({
      queryFn: async ({ cursor }) => {
        // pageSize + 1: лишняя строка говорит, что следующая страница есть (domain/cursor.buildPage).
        const { data, error } = await supabase.rpc("list_conversations_page", {
          p_before_at: cursorArg(cursor?.at),
          p_before_id: cursorArg(cursor?.id),
          p_limit: PAGE_SIZE + 1,
        });
        if (error) return { error: toApiError(error) };
        const rows = data.flatMap((r) => toConversationRow(r) ?? []);
        return { data: buildPage(rows, PAGE_SIZE, keyOfConversation) };
      },
      serializeQueryArgs: ({ endpointName }) => endpointName,
      merge: (current, incoming, { arg }) => {
        const next = arg.cursor === null ? mergeFreshPage(current, incoming, keyOfConversation) : mergePage(current, incoming, keyOfConversation);
        current.rows = next.rows;
        current.nextCursor = next.nextCursor;
      },
    }),

    // Одна строка для шапки: нужна, когда пришли по прямой ссылке и диалога нет в загруженной странице списка.
    // Чужой или несуществующий диалог — null (RLS скрывает строку), экран покажет «Диалог не найден».
    getConversation: build.query<ConversationHeader | null, string>({
      queryFn: async (id) => {
        const { data, error } = await supabase
          .from("conversations")
          .select("id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at")
          .eq("id", id)
          .maybeSingle();
        if (error) return { error: toApiError(error) };
        return { data: toConversationEventRow(data) };
      },
    }),

    getMessages: build.query<Page<Message>, MessagesArgs>({
      queryFn: async ({ conversationId, cursor }) => {
        const { data, error } = await supabase.rpc("get_messages_page", {
          p_conversation_id: conversationId,
          p_before_created_at: cursorArg(cursor?.at),
          p_before_id: cursorArg(cursor?.id),
          p_limit: PAGE_SIZE + 1,
        });
        if (error) return { error: toApiError(error) };
        const rows = data.flatMap((r) => toMessage(r) ?? []);
        return { data: buildPage(rows, PAGE_SIZE, keyOfMessage) };
      },
      serializeQueryArgs: ({ endpointName, queryArgs }) => `${endpointName}(${queryArgs.conversationId})`,
      merge: (current, incoming, { arg }) => {
        // cursor = null — свежая первая страница (открытие, возврат после обрыва): ищет дыру. Иначе — подгрузка старых.
        const next = arg.cursor === null ? mergeFreshPage(current, incoming, keyOfMessage) : mergePage(current, incoming, keyOfMessage);
        current.rows = next.rows;
        current.nextCursor = next.nextCursor;
      },
    }),

    // Сколько диалогов с непрочитанным — для бейджа в навигации и заголовка вкладки.
    getUnreadCount: build.query<number, void>({
      queryFn: async () => {
        const { data, error } = await supabase.rpc("count_unread_conversations");
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: ["UnreadCount"],
    }),

    // Панель «Заявки гостя»: брони и обращения этого диалога, последние 10 каждых (политики select из S05).
    getConversationRequests: build.query<GuestRequestsOfConversation, string>({
      queryFn: async (conversationId) => {
        const [bookings, guestRequests] = await Promise.all([
          supabase
            .from("booking_requests")
            .select("id, booking_at, status, guests_count, replaces_id")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(PANEL_LIMIT),
          supabase
            .from("guest_requests")
            .select("id, kind, status, created_at")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(PANEL_LIMIT),
        ]);
        const error = bookings.error ?? guestRequests.error;
        if (error) return { error: toApiError(error) };
        return { data: { bookings: bookings.data ?? [], guestRequests: guestRequests.data ?? [] } };
      },
      providesTags: ["ConversationRequests"],
    }),

    // Единственная запись клиента в conversations (RPC security definer). Ошибка отметки не показывается
    // менеджеру: отметка повторится при следующем подходящем моменте (спека S06 §2.В).
    markConversationRead: build.mutation<null, { conversationId: string; upTo: string }>({
      queryFn: async ({ conversationId, upTo }) => {
        const { error } = await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId, p_up_to: upTo });
        return error ? { error: toApiError(error) } : { data: null };
      },
      onQueryStarted: async ({ conversationId, upTo }, { dispatch, getState, queryFulfilled }) => {
        try {
          await queryFulfilled;
        } catch {
          return;
        }
        // Не ждём Realtime: бейдж гаснет сразу. Событие потом придёт и станет no-op.
        const cached = chatApi.endpoints.getConversations.select({ cursor: null })(getState() as RootState).data;
        const row = cached?.rows.find((r) => r.id === conversationId);
        if (row) {
          mergeConversationEvent(dispatch, { ...toEventRow(row), manager_last_read_at: upTo });
        } else {
          dispatch(chatApi.util.invalidateTags(["UnreadCount"]));
        }
      },
    }),
  }),
});

export const {
  useGetConversationsQuery,
  useGetConversationQuery,
  useGetMessagesQuery,
  useGetUnreadCountQuery,
  useGetConversationRequestsQuery,
  useMarkConversationReadMutation,
} = chatApi;

// ---------------------------------------------------------------- подгрузка и вливание событий

/** Следующая (более старая) страница ленты. Курсор берётся из кэша вызывающим. Возвращает текст ошибки или null. */
export async function loadOlderMessages(dispatch: AppDispatch, conversationId: string, cursor: Cursor): Promise<string | null> {
  const result = await dispatch(chatApi.endpoints.getMessages.initiate({ conversationId, cursor }, { forceRefetch: true, subscribe: false }));
  return result.error ? ((result.error as { message?: string }).message ?? "Не удалось загрузить") : null;
}

export async function loadMoreConversations(dispatch: AppDispatch, cursor: Cursor): Promise<string | null> {
  const result = await dispatch(chatApi.endpoints.getConversations.initiate({ cursor }, { forceRefetch: true, subscribe: false }));
  return result.error ? ((result.error as { message?: string }).message ?? "Не удалось загрузить") : null;
}

/** Свежая первая страница ленты (после подписки / обрыва): сливается с кэшем, дыра → кэш заменяется. */
export function refreshMessages(dispatch: AppDispatch, conversationId: string): void {
  void dispatch(chatApi.endpoints.getMessages.initiate({ conversationId, cursor: null }, { forceRefetch: true, subscribe: false }));
}

export function refreshConversations(dispatch: AppDispatch): void {
  void dispatch(chatApi.endpoints.getConversations.initiate({ cursor: null }, { forceRefetch: true, subscribe: false }));
  dispatch(chatApi.util.invalidateTags(["UnreadCount"]));
}

/** INSERT из Realtime → кэш ленты (правила — domain/messages.applyMessageEvent). Нет записи кэша — ничего не делаем. */
export function mergeMessageEvent(dispatch: AppDispatch, message: Message): void {
  dispatch(
    chatApi.util.updateQueryData("getMessages", { conversationId: message.conversation_id, cursor: null }, (draft) => {
      const next = applyMessageEvent(draft, message, message.conversation_id);
      if (next !== draft) draft.rows = next.rows;
    }),
  );
}

// События по диалогам идут пачками (шаги брони, серия сообщений): перечитывание списка и счётчика схлопываем.
const REFRESH_DELAY_MS = 500;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshUnreadOnly = true;

function scheduleRefresh(dispatch: AppDispatch, listToo: boolean): void {
  refreshUnreadOnly = refreshUnreadOnly && !listToo;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (refreshUnreadOnly) dispatch(chatApi.util.invalidateTags(["UnreadCount"]));
    else refreshConversations(dispatch);
    refreshUnreadOnly = true;
  }, REFRESH_DELAY_MS);
}

/** Событие conversations (INSERT / UPDATE) → кэш списка. Число непрочитанных уточняется у сервера (domain/conversations). */
export function mergeConversationEvent(dispatch: AppDispatch, event: ConversationEventRow): void {
  let changed = false;
  let needsRefresh = false;
  dispatch(
    chatApi.util.updateQueryData("getConversations", { cursor: null }, (draft) => {
      const change = applyConversationEvent(draft, event);
      needsRefresh = change.needsRefresh;
      if (change.list !== draft) {
        changed = true;
        draft.rows = change.list.rows;
      }
    }),
  );
  if (needsRefresh) scheduleRefresh(dispatch, true);
  else if (changed) scheduleRefresh(dispatch, false);
}

export { toConversationEventRow, toMessage };
