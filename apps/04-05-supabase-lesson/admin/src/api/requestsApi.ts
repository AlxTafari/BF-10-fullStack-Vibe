import { type RowEvent, applyRowEvent } from "@/domain/realtimeMerge";
import {
  LIST_LIMIT,
  type BookingFilter,
  type GuestRequestFilter,
  bookingListSpec,
  guestRequestListSpec,
} from "@/domain/requestLists";
import { rpcErrorText, toRpcErrorCode } from "@/domain/rpcErrors";
import { baseApi } from "./baseApi";
import type { Tables } from "./database.types";
import { toApiError } from "./errors";
import type { AppDispatch, RootState } from "./store";
import { supabase } from "./supabaseClient";

export type BookingRequest = Tables<"booking_requests">;
export type GuestRequest = Tables<"guest_requests">;

/** Ключ кэша списка: ресторан + фильтр. Размер страницы (20/50/100) сюда не входит — это срез на клиенте. */
export type BookingsArgs = BookingFilter & { restaurantId: string };
export type GuestRequestsArgs = GuestRequestFilter & { restaurantId: string };

export interface OpenCounts {
  /** Брони со статусом pending. */
  bookings: number;
  /** Обращения со статусом new. */
  guestRequests: number;
}

export interface StatusChange {
  id: string;
  /** Статус, который менеджер видел на экране (оптимистичная блокировка в RPC). */
  from: string;
  to: string;
}

export const requestsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // SQL здесь повторяет правила domain/requestLists (bookingListSpec): то, что вернул запрос, и то, что
    // собрал applyRowEvent из событий, должно совпадать. Второй ключ сортировки — id: порядок полный.
    getBookings: build.query<BookingRequest[], BookingsArgs>({
      queryFn: async ({ restaurantId, tab, when }) => {
        let query = supabase.from("booking_requests").select("*").eq("restaurant_id", restaurantId);
        switch (tab) {
          case "pending":
            query = query.eq("status", "pending").order("booking_at", { ascending: true });
            break;
          case "confirmed": {
            const now = new Date().toISOString();
            query =
              when === "upcoming"
                ? query.eq("status", "confirmed").gte("booking_at", now).order("booking_at", { ascending: true })
                : query.eq("status", "confirmed").lt("booking_at", now).order("booking_at", { ascending: false });
            break;
          }
          case "closed":
            query = query.in("status", ["declined", "cancelled"]).order("updated_at", { ascending: false });
            break;
          case "all":
            query = query.order("booking_at", { ascending: false });
            break;
        }
        const { data, error } = await query.order("id").limit(LIST_LIMIT);
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: ["BookingList"],
    }),

    getBooking: build.query<BookingRequest, string>({
      queryFn: async (id) => {
        const { data, error } = await supabase.from("booking_requests").select("*").eq("id", id).single();
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: (_result, _error, id) => [{ type: "Booking", id }],
    }),

    getGuestRequests: build.query<GuestRequest[], GuestRequestsArgs>({
      queryFn: async ({ restaurantId, tab, kind }) => {
        let query = supabase.from("guest_requests").select("*").eq("restaurant_id", restaurantId);
        if (tab !== "all") query = query.eq("status", tab);
        if (kind !== "all") query = query.eq("kind", kind);
        const { data, error } = await query.order("created_at", { ascending: false }).order("id").limit(LIST_LIMIT);
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: ["GuestRequestList"],
    }),

    getGuestRequest: build.query<GuestRequest, string>({
      queryFn: async (id) => {
        const { data, error } = await supabase.from("guest_requests").select("*").eq("id", id).single();
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: (_result, _error, id) => [{ type: "GuestRequest", id }],
    }),

    // Бейджи в навигации: считаем на сервере (head: true — только число, без строк).
    getOpenCounts: build.query<OpenCounts, string>({
      queryFn: async (restaurantId) => {
        const [bookings, guestRequests] = await Promise.all([
          supabase
            .from("booking_requests")
            .select("id", { count: "exact", head: true })
            .eq("restaurant_id", restaurantId)
            .eq("status", "pending"),
          supabase
            .from("guest_requests")
            .select("id", { count: "exact", head: true })
            .eq("restaurant_id", restaurantId)
            .eq("status", "new"),
        ]);
        const error = bookings.error ?? guestRequests.error;
        if (error) return { error: toApiError(error) };
        return { data: { bookings: bookings.count ?? 0, guestRequests: guestRequests.count ?? 0 } };
      },
      providesTags: ["OpenCounts"],
    }),

    // Смена статуса — ПЕССИМИСТИЧНАЯ: ждём ответ сервера. Менеджер может состязаться с гостем (тот отменил, пока
    // менеджер смотрел карточку), и откатывать показанный «успех» хуже, чем подождать полсекунды.
    // По успеху возвращённая строка вливается во все списки и в карточку (та же функция, что и для событий Realtime);
    // по status_conflict строка перечитывается — на экране появляется статус, какой он на самом деле.
    setBookingStatus: build.mutation<BookingRequest, StatusChange>({
      queryFn: async ({ id, from, to }) => {
        const { data, error } = await supabase.rpc("set_booking_status", { p_id: id, p_from: from, p_to: to });
        if (error) return { error: { message: rpcErrorText(error.message), code: toRpcErrorCode(error.message) ?? undefined } };
        return { data };
      },
      onQueryStarted: async ({ id, to }, { dispatch, getState, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          mergeBookingEvent(dispatch, getState, { type: "UPDATE", row: data });
          // Отклонение/отмена брони и подтверждение изменения затрагивают ВТОРУЮ строку (каскад в RPC):
          // её нового вида у нас нет — перечитываем списки. Realtime принесёт то же, но не будем на него полагаться.
          const cascade = to === "declined" || to === "cancelled" || data.replaces_id !== null;
          dispatch(requestsApi.util.invalidateTags(cascade ? ["OpenCounts", "BookingList", "Booking"] : ["OpenCounts"]));
        } catch (e) {
          if ((e as { error?: { code?: string } }).error?.code === "status_conflict") {
            await refreshBooking(dispatch, getState, id);
          }
        }
      },
    }),

    setGuestRequestStatus: build.mutation<GuestRequest, StatusChange>({
      queryFn: async ({ id, from, to }) => {
        const { data, error } = await supabase.rpc("set_guest_request_status", { p_id: id, p_from: from, p_to: to });
        if (error) return { error: { message: rpcErrorText(error.message), code: toRpcErrorCode(error.message) ?? undefined } };
        return { data };
      },
      onQueryStarted: async ({ id }, { dispatch, getState, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          mergeGuestRequestEvent(dispatch, getState, { type: "UPDATE", row: data });
          dispatch(requestsApi.util.invalidateTags(["OpenCounts"]));
        } catch (e) {
          if ((e as { error?: { code?: string } }).error?.code === "status_conflict") {
            await refreshGuestRequest(dispatch, getState, id);
          }
        }
      },
    }),
  }),
});

export const {
  useGetBookingsQuery,
  useGetBookingQuery,
  useGetGuestRequestsQuery,
  useGetGuestRequestQuery,
  useGetOpenCountsQuery,
  useSetBookingStatusMutation,
  useSetGuestRequestStatusMutation,
} = requestsApi;

// ---------------------------------------------------------------- вливание строк в кэш
// Общая точка для ответа RPC и событий Realtime: правила — чистая функция applyRowEvent (domain/realtimeMerge).

type Dispatch = AppDispatch;
// getState из onQueryStarted типизирован частичным состоянием api; нам нужно только оно.
type GetState = () => unknown;

/** Карточка в кэше: заменяем строку, только если пришедшая не старее. */
function patchCard<T extends { updated_at: string }>(draft: T, row: T): T | void {
  return Date.parse(row.updated_at) >= Date.parse(draft.updated_at) ? row : undefined;
}

export function mergeBookingEvent(dispatch: Dispatch, getState: GetState, event: RowEvent<BookingRequest>): void {
  const now = new Date();
  for (const args of requestsApi.util.selectCachedArgsForQuery(getState() as RootState, "getBookings")) {
    dispatch(
      requestsApi.util.updateQueryData("getBookings", args, (draft) => {
        const next = applyRowEvent(draft, event, bookingListSpec<BookingRequest>(args, now));
        if (next !== draft) draft.splice(0, draft.length, ...next);
      }),
    );
  }
  if (event.type !== "DELETE") {
    const { row } = event;
    // updateQueryData не создаёт запись кэша, если её нет, — карточка, которую никто не открывал, не раздувает кэш.
    dispatch(requestsApi.util.updateQueryData("getBooking", row.id, (draft) => patchCard(draft, row)));
  }
}

export function mergeGuestRequestEvent(dispatch: Dispatch, getState: GetState, event: RowEvent<GuestRequest>): void {
  for (const args of requestsApi.util.selectCachedArgsForQuery(getState() as RootState, "getGuestRequests")) {
    dispatch(
      requestsApi.util.updateQueryData("getGuestRequests", args, (draft) => {
        const next = applyRowEvent(draft, event, guestRequestListSpec<GuestRequest>(args));
        if (next !== draft) draft.splice(0, draft.length, ...next);
      }),
    );
  }
  if (event.type !== "DELETE") {
    const { row } = event;
    dispatch(requestsApi.util.updateQueryData("getGuestRequest", row.id, (draft) => patchCard(draft, row)));
  }
}

async function refreshBooking(dispatch: Dispatch, getState: GetState, id: string): Promise<void> {
  const result = await dispatch(requestsApi.endpoints.getBooking.initiate(id, { forceRefetch: true }));
  if (result.data) mergeBookingEvent(dispatch, getState, { type: "UPDATE", row: result.data });
  dispatch(requestsApi.util.invalidateTags(["OpenCounts"]));
}

async function refreshGuestRequest(dispatch: Dispatch, getState: GetState, id: string): Promise<void> {
  const result = await dispatch(requestsApi.endpoints.getGuestRequest.initiate(id, { forceRefetch: true }));
  if (result.data) mergeGuestRequestEvent(dispatch, getState, { type: "UPDATE", row: result.data });
  dispatch(requestsApi.util.invalidateTags(["OpenCounts"]));
}
