// Вливание строк (ответ RPC и события Realtime) в кэш RTK Query — склейка вокруг applyRowEvent (S07, хвост S05).
// Правила слияния списка проверены в domain/realtimeMerge.test.ts; здесь — что склейка применяет их ко ВСЕМ
// закэшированным спискам, не создаёт карточки, которых никто не открывал, и не откатывает карточку старой строкой.
// Сеть не нужна: кэш заполняется upsertQueryData, Supabase-клиент подменён.
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it, vi } from "vitest";

// Настоящий клиент требует VITE_SUPABASE_* при импорте; запросы в этих тестах не выполняются.
vi.mock("./supabaseClient", () => ({ supabase: {} }));

const { baseApi } = await import("./baseApi");
const { requestsApi, mergeBookingEvent, mergeGuestRequestEvent } = await import("./requestsApi");
type BookingRequest = import("./requestsApi").BookingRequest;
type GuestRequest = import("./requestsApi").GuestRequest;
type BookingsArgs = import("./requestsApi").BookingsArgs;
type GuestRequestsArgs = import("./requestsApi").GuestRequestsArgs;

function createTestStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
}

type TestStore = ReturnType<typeof createTestStore>;
// mergeXxxEvent типизированы под dispatch приложения; у тестового стора тот же api-срез.
type MergeDispatch = Parameters<typeof mergeBookingEvent>[0];

const restaurantId = "00000000-0000-0000-0000-00000000a001";
const future = new Date(Date.now() + 86_400_000).toISOString();

function booking(id: string, patch: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id,
    restaurant_id: restaurantId,
    conversation_id: null,
    guest_name: "Гость",
    contact: "+302310000000",
    booking_at: future,
    guests_count: 2,
    comment: null,
    status: "pending",
    idempotency_key: `k-${id}`,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    manager_notified_at: null,
    guest_notified_at: null,
    replaces_id: null,
    ...patch,
  };
}

function guestRequest(id: string, patch: Partial<GuestRequest> = {}): GuestRequest {
  return {
    id,
    restaurant_id: restaurantId,
    conversation_id: null,
    kind: "complaint",
    text: "текст",
    contact: null,
    status: "new",
    idempotency_key: `g-${id}`,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    manager_notified_at: null,
    ...patch,
  };
}

const pendingTab: BookingsArgs = { restaurantId, tab: "pending", when: "upcoming" };
const closedTab: BookingsArgs = { restaurantId, tab: "closed", when: "upcoming" };

async function seedBookings(store: TestStore, args: BookingsArgs, rows: BookingRequest[]) {
  await store.dispatch(requestsApi.util.upsertQueryData("getBookings", args, rows));
}

const bookingIds = (store: TestStore, args: BookingsArgs) =>
  requestsApi.endpoints.getBookings.select(args)(store.getState()).data?.map((r) => r.id);

function mergeBooking(store: TestStore, event: Parameters<typeof mergeBookingEvent>[2]) {
  mergeBookingEvent(store.dispatch as MergeDispatch, store.getState, event);
}

describe("mergeBookingEvent", () => {
  it("смена статуса переносит строку между всеми закэшированными списками", async () => {
    const store = createTestStore();
    await seedBookings(store, pendingTab, [booking("b1"), booking("b2")]);
    await seedBookings(store, closedTab, []);

    mergeBooking(store, { type: "UPDATE", row: booking("b1", { status: "declined", updated_at: "2026-11-01T11:00:00Z" }) });

    expect(bookingIds(store, pendingTab)).toEqual(["b2"]);
    expect(bookingIds(store, closedTab)).toEqual(["b1"]);
  });

  it("дубль события ничего не меняет", async () => {
    const store = createTestStore();
    await seedBookings(store, pendingTab, [booking("b1")]);
    const event = { type: "INSERT" as const, row: booking("b2") };

    mergeBooking(store, event);
    mergeBooking(store, event);

    expect(bookingIds(store, pendingTab)?.sort()).toEqual(["b1", "b2"]);
  });

  it("DELETE строки, которой нет в кэше, — без изменений (ADR-003: DELETE приходит всем)", async () => {
    const store = createTestStore();
    await seedBookings(store, pendingTab, [booking("b1")]);

    mergeBooking(store, { type: "DELETE", id: "foreign" });
    expect(bookingIds(store, pendingTab)).toEqual(["b1"]);

    mergeBooking(store, { type: "DELETE", id: "b1" });
    expect(bookingIds(store, pendingTab)).toEqual([]);
  });

  it("карточку, которую никто не открывал, не создаёт", () => {
    const store = createTestStore();
    mergeBooking(store, { type: "UPDATE", row: booking("b1") });
    expect(requestsApi.endpoints.getBooking.select("b1")(store.getState()).data).toBeUndefined();
  });

  it("открытая карточка: новая строка заменяет, запоздавшая старая — нет", async () => {
    const store = createTestStore();
    await store.dispatch(requestsApi.util.upsertQueryData("getBooking", "b1", booking("b1", { updated_at: "2026-11-01T11:00:00Z" })));
    const card = () => requestsApi.endpoints.getBooking.select("b1")(store.getState()).data;

    mergeBooking(store, { type: "UPDATE", row: booking("b1", { status: "pending", updated_at: "2026-11-01T10:30:00Z" }) });
    expect(card()?.updated_at).toBe("2026-11-01T11:00:00Z");

    mergeBooking(store, { type: "UPDATE", row: booking("b1", { status: "confirmed", updated_at: "2026-11-01T12:00:00Z" }) });
    expect(card()?.status).toBe("confirmed");
  });
});

describe("mergeGuestRequestEvent", () => {
  it("применяет фильтр по типу: жалоба не попадает в список запросов менеджеру", async () => {
    const store = createTestStore();
    const managerTab: GuestRequestsArgs = { restaurantId, tab: "all", kind: "manager_request" };
    const allTab: GuestRequestsArgs = { restaurantId, tab: "all", kind: "all" };
    await store.dispatch(requestsApi.util.upsertQueryData("getGuestRequests", managerTab, []));
    await store.dispatch(requestsApi.util.upsertQueryData("getGuestRequests", allTab, []));

    mergeGuestRequestEvent(store.dispatch as MergeDispatch, store.getState, { type: "INSERT", row: guestRequest("g1") });

    const ids = (args: GuestRequestsArgs) =>
      requestsApi.endpoints.getGuestRequests.select(args)(store.getState()).data?.map((r) => r.id);
    expect(ids(managerTab)).toEqual([]);
    expect(ids(allTab)).toEqual(["g1"]);
  });
});
