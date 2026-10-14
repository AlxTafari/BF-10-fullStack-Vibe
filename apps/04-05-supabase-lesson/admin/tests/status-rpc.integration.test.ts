// Интеграционный тест RPC смены статусов против dev-БД (спека S05 §2.А, инварианты 1–5).
// Проверяет то, что нельзя выразить политикой: матрицу переходов, оптимистичную блокировку (p_from),
// атомарное подтверждение изменения, каскады, границы доступа и гонку двух вызовов.
// Запуск и ключи — как у rls.integration.test.ts; без SUPABASE_SERVICE_ROLE_KEY файл пропускается.
// Создаёт свои рестораны и пользователей, удаляет их в afterAll.
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const runId = Math.random().toString(36).slice(2, 8);

const BOOKING_STATUSES = ["pending", "confirmed", "declined", "cancelled"] as const;
const GUEST_STATUSES = ["new", "in_progress", "resolved"] as const;
type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Матрица из спеки §2.А: единственная копия в тесте; в domain/ будет вторая, их сверяет этот же тест. */
const ALLOWED: ReadonlyArray<readonly [BookingStatus, BookingStatus]> = [
  ["pending", "confirmed"],
  ["pending", "declined"],
  ["pending", "cancelled"],
  ["confirmed", "cancelled"],
];

const DAY = 86_400_000;
let counter = 0;

describe.skipIf(!enabled)("RPC смены статусов заявок", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let managerA: SupabaseClient;
  let managerB: SupabaseClient;
  let outsider: SupabaseClient;
  let restaurantA: string;
  let restaurantB: string;
  const userIds: string[] = [];
  const restaurantIds: string[] = [];

  async function signedIn(label: string): Promise<{ client: SupabaseClient; id: string }> {
    const email = `rpc-${label}-${runId}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`setup user ${label}: ${created.error?.message}`);
    userIds.push(created.data.user.id);
    const client = createClient(url!, anonKey!, AUTH_OPTS);
    const res = await client.auth.signInWithPassword({ email, password });
    if (res.error) throw new Error(`sign in ${label}: ${res.error.message}`);
    return { client, id: created.data.user.id };
  }

  async function restaurant(label: string): Promise<string> {
    const res = await service.from("restaurants").insert({ name: `rpc-test-${label}-${runId}` }).select("id").single();
    if (res.error) throw new Error(`restaurant ${label}: ${res.error.message}`);
    restaurantIds.push(res.data.id);
    return res.data.id;
  }

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, AUTH_OPTS);
    anon = createClient(url!, anonKey!, AUTH_OPTS);
    restaurantA = await restaurant("A");
    restaurantB = await restaurant("B");
    const a = await signedIn("manager-a");
    const b = await signedIn("manager-b");
    outsider = (await signedIn("outsider")).client;
    managerA = a.client;
    managerB = b.client;
    await service.from("restaurant_managers").insert({ user_id: a.id, restaurant_id: restaurantA });
    await service.from("restaurant_managers").insert({ user_id: b.id, restaurant_id: restaurantB });
  }, 60_000);

  afterAll(async () => {
    if (restaurantIds.length > 0) await service.from("restaurants").delete().in("id", restaurantIds);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  }, 60_000);

  /** Бронь в заданном статусе (создаём service role'ом: так бот создаёт заявки, минуя RPC). */
  async function makeBooking(
    status: BookingStatus,
    extra: { booking_at?: string; replaces_id?: string; restaurant_id?: string } = {},
  ): Promise<string> {
    const res = await service
      .from("booking_requests")
      .insert({
        restaurant_id: extra.restaurant_id ?? restaurantA,
        guest_name: "rpc",
        contact: "rpc",
        booking_at: extra.booking_at ?? new Date(Date.now() + 2 * DAY).toISOString(),
        guests_count: 2,
        status,
        replaces_id: extra.replaces_id ?? null,
        idempotency_key: `rpc-${runId}-${counter++}`,
      })
      .select("id")
      .single();
    if (res.error) throw new Error(`makeBooking: ${res.error.message}`);
    return res.data.id;
  }

  async function statusOf(id: string): Promise<string> {
    const res = await service.from("booking_requests").select("status").eq("id", id).single();
    return res.data!.status;
  }

  const setBooking = (client: SupabaseClient, id: string, from: string, to: string) =>
    client.rpc("set_booking_status", { p_id: id, p_from: from, p_to: to });

  describe("границы доступа", () => {
    it("аноним не может вызвать RPC", async () => {
      const id = await makeBooking("pending");
      const res = await setBooking(anon, id, "pending", "confirmed");
      expect(res.error).not.toBeNull();
      expect(await statusOf(id)).toBe("pending");
    });

    it("посторонний и менеджер чужого ресторана получают not_manager, статус не меняется", async () => {
      const id = await makeBooking("pending");
      for (const client of [outsider, managerB]) {
        const res = await setBooking(client, id, "pending", "confirmed");
        expect(res.error?.message).toBe("not_manager");
      }
      expect(await statusOf(id)).toBe("pending");
    });

    it("несуществующая заявка — not_found", async () => {
      const res = await setBooking(managerA, crypto.randomUUID(), "pending", "confirmed");
      expect(res.error?.message).toBe("not_found");
    });
  });

  describe("матрица переходов брони", () => {
    const pairs = BOOKING_STATUSES.flatMap((from) => BOOKING_STATUSES.map((to) => [from, to] as const));

    it.each(pairs)("%s → %s", async (from, to) => {
      const id = await makeBooking(from);
      const res = await setBooking(managerA, id, from, to);
      const allowed = ALLOWED.some(([f, t]) => f === from && t === to);
      if (allowed) {
        expect(res.error).toBeNull();
        expect((res.data as { status: string }).status).toBe(to);
        expect(await statusOf(id)).toBe(to);
      } else {
        expect(res.error?.message).toBe("transition_not_allowed");
        expect(await statusOf(id)).toBe(from);
      }
    });
  });

  describe("оптимистичная блокировка", () => {
    it("устаревший p_from → status_conflict, ничего не меняется", async () => {
      const id = await makeBooking("pending");
      // «гость отменил, пока менеджер смотрел карточку»
      await service.from("booking_requests").update({ status: "cancelled" }).eq("id", id);
      const res = await setBooking(managerA, id, "pending", "confirmed");
      expect(res.error?.message).toBe("status_conflict");
      expect(await statusOf(id)).toBe("cancelled");
    });

    it("два параллельных вызова с одним p_from: ровно один успех", async () => {
      const id = await makeBooking("pending");
      const results = await Promise.all([
        setBooking(managerA, id, "pending", "confirmed"),
        setBooking(managerA, id, "pending", "declined"),
      ]);
      const ok = results.filter((r) => r.error === null);
      const failed = results.filter((r) => r.error !== null);
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      // проигравший видит новый статус как конфликт (или запрет, если победитель — финальный статус)
      expect(["status_conflict", "transition_not_allowed"]).toContain(failed[0]!.error!.message);
    });

    it("смена статуса сбрасывает guest_notified_at", async () => {
      const id = await makeBooking("pending");
      await service.from("booking_requests").update({ guest_notified_at: new Date().toISOString() }).eq("id", id);
      const res = await setBooking(managerA, id, "pending", "confirmed");
      expect(res.error).toBeNull();
      const row = await service.from("booking_requests").select("guest_notified_at").eq("id", id).single();
      expect(row.data?.guest_notified_at).toBeNull();
    });
  });

  describe("бронь в прошлом", () => {
    const past = () => new Date(Date.now() - DAY).toISOString();

    it("подтвердить нельзя (booking_in_past)", async () => {
      const id = await makeBooking("pending", { booking_at: past() });
      const res = await setBooking(managerA, id, "pending", "confirmed");
      expect(res.error?.message).toBe("booking_in_past");
      expect(await statusOf(id)).toBe("pending");
    });

    it("отклонить и отменить можно", async () => {
      const declined = await makeBooking("pending", { booking_at: past() });
      expect((await setBooking(managerA, declined, "pending", "declined")).error).toBeNull();
      const cancelled = await makeBooking("pending", { booking_at: past() });
      expect((await setBooking(managerA, cancelled, "pending", "cancelled")).error).toBeNull();
    });
  });

  describe("запрос на изменение брони", () => {
    it("подтверждение: исходная cancelled, изменение confirmed", async () => {
      const original = await makeBooking("confirmed");
      const change = await makeBooking("pending", { replaces_id: original });
      const res = await setBooking(managerA, change, "pending", "confirmed");
      expect(res.error).toBeNull();
      expect(await statusOf(original)).toBe("cancelled");
      expect(await statusOf(change)).toBe("confirmed");
    });

    it("исходная уже не активна → original_not_active, изменение остаётся pending (атомарность)", async () => {
      const original = await makeBooking("confirmed");
      const change = await makeBooking("pending", { replaces_id: original });
      await service.from("booking_requests").update({ status: "cancelled" }).eq("id", original);
      const res = await setBooking(managerA, change, "pending", "confirmed");
      expect(res.error?.message).toBe("original_not_active");
      expect(await statusOf(change)).toBe("pending");
      expect(await statusOf(original)).toBe("cancelled");
    });

    it("отклонение или отмена самого изменения не трогает исходную бронь", async () => {
      for (const to of ["declined", "cancelled"] as const) {
        const original = await makeBooking("confirmed");
        const change = await makeBooking("pending", { replaces_id: original });
        expect((await setBooking(managerA, change, "pending", to)).error).toBeNull();
        expect(await statusOf(original)).toBe("confirmed");
        expect(await statusOf(change)).toBe(to);
      }
    });

    it("закрытие исходной брони отменяет её ожидающее изменение", async () => {
      const original = await makeBooking("confirmed");
      const change = await makeBooking("pending", { replaces_id: original });
      expect((await setBooking(managerA, original, "confirmed", "cancelled")).error).toBeNull();
      expect(await statusOf(change)).toBe("cancelled");
    });

    it("отклонение исходной pending-брони тоже отменяет изменение", async () => {
      const original = await makeBooking("pending");
      const change = await makeBooking("pending", { replaces_id: original });
      expect((await setBooking(managerA, original, "pending", "declined")).error).toBeNull();
      expect(await statusOf(change)).toBe("cancelled");
    });

    it("одновременно: подтверждение изменения и отмена исходной — без взаимной блокировки, согласованный итог", async () => {
      const original = await makeBooking("confirmed");
      const change = await makeBooking("pending", { replaces_id: original });
      const results = await Promise.all([
        setBooking(managerA, change, "pending", "confirmed"),
        setBooking(managerA, original, "confirmed", "cancelled"),
      ]);
      // Какой бы порядок ни выиграл, «двух подтверждённых броней» и зависшего pending быть не может.
      expect(await statusOf(original)).toBe("cancelled");
      expect(["confirmed", "cancelled"]).toContain(await statusOf(change));
      expect(results.some((r) => r.error === null)).toBe(true);
    });
  });

  describe("обращения", () => {
    async function makeGuestRequest(status: string): Promise<string> {
      const res = await service
        .from("guest_requests")
        .insert({ restaurant_id: restaurantA, kind: "feedback", text: "t", status, idempotency_key: `rpc-g-${runId}-${counter++}` })
        .select("id")
        .single();
      if (res.error) throw new Error(`makeGuestRequest: ${res.error.message}`);
      return res.data.id;
    }
    const setGuest = (client: SupabaseClient, id: string, from: string, to: string) =>
      client.rpc("set_guest_request_status", { p_id: id, p_from: from, p_to: to });

    const pairs = GUEST_STATUSES.flatMap((from) => GUEST_STATUSES.map((to) => [from, to] as const));

    it.each(pairs)("%s → %s", async (from, to) => {
      const id = await makeGuestRequest(from);
      const res = await setGuest(managerA, id, from, to);
      if (from === to) {
        expect(res.error?.message).toBe("transition_not_allowed");
      } else {
        expect(res.error).toBeNull();
        expect((res.data as { status: string }).status).toBe(to);
      }
    });

    it("status_conflict при устаревшем p_from", async () => {
      const id = await makeGuestRequest("new");
      await service.from("guest_requests").update({ status: "resolved" }).eq("id", id);
      expect((await setGuest(managerA, id, "new", "in_progress")).error?.message).toBe("status_conflict");
    });

    it("чужой менеджер, посторонний и аноним не меняют статус", async () => {
      const id = await makeGuestRequest("new");
      expect((await setGuest(managerB, id, "new", "in_progress")).error?.message).toBe("not_manager");
      expect((await setGuest(outsider, id, "new", "in_progress")).error?.message).toBe("not_manager");
      expect((await setGuest(anon, id, "new", "in_progress")).error).not.toBeNull();
      const row = await service.from("guest_requests").select("status").eq("id", id).single();
      expect(row.data?.status).toBe("new");
    });
  });
});
