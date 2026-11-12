import { type ConversationEventRow, type ConversationRow, applyConversationEvent, keyOfConversation, toEventRow } from "@/domain/conversations";
import { type Cursor, type Page, PAGE_SIZE, buildPage, mergeFreshPage, mergePage } from "@/domain/cursor";
import { type Delivery, managerChatErrorText } from "@/domain/handoff";
import { type Message, applyMessageEvent, applyVoiceTranscript, keyOfMessage } from "@/domain/messages";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { baseApi } from "./baseApi";
import { toConversationEventRow, toConversationRow, toMessage } from "./chatMappers";
import { type ApiError, toApiError } from "./errors";
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

/** Ответы Edge Function manager-chat (S06b) — как их отдаёт сервис. */
export interface JoinChatResult {
  handoffUntil: string;
  delivery: Delivery;
}
export type ManagerReplyResult =
  | { handoffUntil: string; delivery: "sent"; recorded: boolean }
  | { handoffUntil: string; delivery: "blocked" | "failed" };

/**
 * Вызов manager-chat. Ошибка функции (4xx/5xx) приходит как FunctionsHttpError, а код — в теле ответа
 * ({ error: "handoff_inactive" }); его достаём из context (Response) и переводим в текст для менеджера.
 */
async function invokeManagerChat<T>(body: Record<string, unknown>): Promise<{ data: T } | { error: ApiError }> {
  const { data, error } = await supabase.functions.invoke<T>("manager-chat", { body });
  if (!error) return { data: data as T };
  if (error instanceof FunctionsHttpError) {
    let code: string | undefined;
    try {
      code = ((await error.context.json()) as { error?: string }).error;
    } catch {
      code = undefined;
    }
    return { error: { message: managerChatErrorText(code), ...(code ? { code } : {}) } };
  }
  return { error: toApiError(error) };
}

/**
 * Новая метка ручного режима → кэши списка и шапки сразу, не дожидаясь Realtime (событие потом станет no-op).
 * Шапка — по прямой ссылке диалога в загруженной странице списка может не быть.
 */
function applyHandoff(
  dispatch: AppDispatch,
  getState: () => unknown,
  conversationId: string,
  handoffUntil: string | null,
): void {
  const cached = chatApi.endpoints.getConversations.select({ cursor: null })(getState() as RootState).data;
  const row = cached?.rows.find((r) => r.id === conversationId);
  if (row) mergeConversationEvent(dispatch, { ...toEventRow(row), handoff_until: handoffUntil });
  dispatch(
    chatApi.util.updateQueryData("getConversation", conversationId, (draft) => {
      if (draft) draft.handoff_until = handoffUntil;
    }),
  );
}

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
          .select("id, display_name, channel, created_at, last_message_at, last_message_preview, last_message_direction, manager_last_read_at, flagged_at, flag_reason, handoff_until")
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

    // «Разобрано» (S09): снимает пометку угрозы. Пессимистично: бейдж гаснет после ответа БД, событие Realtime
    // потом придёт и станет no-op. Шапка (getConversation) обновляется тут же — по прямой ссылке списка может не быть.
    resolveConversationFlag: build.mutation<null, string>({
      queryFn: async (conversationId) => {
        const { error } = await supabase.rpc("resolve_conversation_flag", { p_conversation_id: conversationId });
        return error ? { error: toApiError(error) } : { data: null };
      },
      onQueryStarted: async (conversationId, { dispatch, getState, queryFulfilled }) => {
        try {
          await queryFulfilled;
        } catch {
          return;
        }
        const cached = chatApi.endpoints.getConversations.select({ cursor: null })(getState() as RootState).data;
        const row = cached?.rows.find((r) => r.id === conversationId);
        if (row) mergeConversationEvent(dispatch, { ...toEventRow(row), flagged_at: null, flag_reason: null });
        dispatch(
          chatApi.util.updateQueryData("getConversation", conversationId, (draft) => {
            if (draft) {
              draft.flagged_at = null;
              draft.flag_reason = null;
            }
          }),
        );
      },
    }),

    // ---------------------------------------------------------------- менеджер в диалоге (S06b)
    // Всё через Edge Function manager-chat: ей нужен Telegram, а членство проверяют RPC под JWT менеджера.
    // Новое сообщение в ленту приходит по Realtime, как любое другое: оптимистичной вставки нет, источник правды один.

    // «Подключиться к чату»: ручной режим + уведомление гостю (повторное подключение второй раз не пишет).
    joinChat: build.mutation<JoinChatResult, string>({
      queryFn: (conversationId) => invokeManagerChat<JoinChatResult>({ action: "join", conversation_id: conversationId }),
      onQueryStarted: async (conversationId, { dispatch, getState, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          applyHandoff(dispatch, getState, conversationId, data.handoffUntil);
        } catch {
          // ошибку показывает компонент
        }
      },
    }),

    // Ответ гостю. Недоставленное (blocked / failed) — не ошибка запроса, а результат: менеджер видит причину,
    // текст остаётся в поле. handoff_inactive — ошибка с кодом: компонент возвращает кнопку «Подключиться».
    sendManagerReply: build.mutation<ManagerReplyResult, { conversationId: string; text: string }>({
      queryFn: ({ conversationId, text }) => invokeManagerChat<ManagerReplyResult>({ action: "reply", conversation_id: conversationId, text }),
      onQueryStarted: async ({ conversationId }, { dispatch, getState, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          applyHandoff(dispatch, getState, conversationId, data.handoffUntil);
        } catch (e) {
          // Режим истёк на сервере — гасим его и в кэше, чтобы вместо поля появилась кнопка «Подключиться».
          if ((e as { error?: ApiError }).error?.code === "handoff_inactive") applyHandoff(dispatch, getState, conversationId, null);
        }
      },
    }),

    // «Отключиться»: разговор возвращается боту, гостю уведомление (если режим ещё шёл).
    leaveChat: build.mutation<{ delivery: Delivery }, string>({
      queryFn: (conversationId) => invokeManagerChat<{ delivery: Delivery }>({ action: "leave", conversation_id: conversationId }),
      onQueryStarted: async (conversationId, { dispatch, getState, queryFulfilled }) => {
        try {
          await queryFulfilled;
          applyHandoff(dispatch, getState, conversationId, null);
        } catch {
          // ошибку показывает компонент
        }
      },
    }),

    // ---------------------------------------------------------------- голосовые гостя (S09, сессия 4)
    // Подключаться к чату не нужно: слушать и распознавать можно любое голосовое своего ресторана (RLS в функции).

    // Звук для плеера. Запрашивается по клику «Прослушать», а не при открытии чата: каждое — скачивание у Telegram.
    // В кэше — строка blob:-URL, а не Blob: состояние Redux должно быть сериализуемым. URL освобождаем, когда запись
    // кэша удаляется (keepUnusedDataFor после закрытия плеера), иначе браузер держал бы байты до перезагрузки.
    getVoiceAudio: build.query<string, string>({
      queryFn: async (messageId) => {
        // manager-chat отдаёт application/octet-stream — functions.invoke возвращает Blob (см. index.ts функции).
        const result = await invokeManagerChat<Blob>({ action: "voice_audio", message_id: messageId });
        if ("error" in result) return result;
        return { data: URL.createObjectURL(new Blob([result.data], { type: "audio/ogg" })) };
      },
      keepUnusedDataFor: 300,
      onCacheEntryAdded: async (_messageId, { cacheDataLoaded, cacheEntryRemoved }) => {
        try {
          const { data } = await cacheDataLoaded;
          await cacheEntryRemoved;
          URL.revokeObjectURL(data);
        } catch {
          // запрос не удался — освобождать нечего
        }
      },
    }),

    // «Распознать»: расшифровка пишется в сообщение на сервере; в ленту подставляем её из ответа. Realtime шлёт только
    // INSERT, правку сообщения он не принесёт — у другого менеджера текст появится после перезагрузки ленты.
    transcribeVoice: build.mutation<{ text: string }, { messageId: string; conversationId: string }>({
      queryFn: ({ messageId }) => invokeManagerChat<{ text: string }>({ action: "voice_transcribe", message_id: messageId }),
      onQueryStarted: async ({ messageId, conversationId }, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            chatApi.util.updateQueryData("getMessages", { conversationId, cursor: null }, (draft) => {
              const next = applyVoiceTranscript(draft, messageId, data.text);
              if (next !== draft) draft.rows = next.rows;
            }),
          );
        } catch {
          // ошибку показывает компонент
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
  useResolveConversationFlagMutation,
  useJoinChatMutation,
  useSendManagerReplyMutation,
  useLeaveChatMutation,
  useGetVoiceAudioQuery,
  useTranscribeVoiceMutation,
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
