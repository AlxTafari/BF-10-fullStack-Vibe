// Проверка Realtime + RLS на dev-БД (спека S05, вопрос 7). Что проверяем:
//  1. менеджер получает события СВОЕГО ресторана (INSERT и UPDATE);
//  2. менеджер другого ресторана, посторонний и аноним НЕ получают ничего (RLS применяется к postgres_changes);
//  3. формат payload (updated_at, booking_at) совпадает с ответом PostgREST — от этого зависит applyRowEvent.
// Запуск: pnpm test (нужны SUPABASE_* в .env корня, как у rls.integration.test.ts; без них файл пропускается).
// Создаёт свои рестораны и пользователей, удаляет их в afterAll.
import { type RealtimeChannel, type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const runId = Math.random().toString(36).slice(2, 8);

interface Event {
  eventType: string;
  new: Record<string, unknown>;
}

// Realtime не применяет RLS к DELETE (удалённую строку уже нельзя прочитать): такие события получают все
// подписчики таблицы, но только с первичным ключом. Другие тесты (каскадная очистка ресторанов) их порождают,
// поэтому здесь важны только INSERT/UPDATE — в них приходят данные строки.
const dataEvents = (events: Event[]) => events.filter((e) => e.eventType !== "DELETE");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!enabled)("Realtime + RLS: заявки", () => {
  let service: SupabaseClient;
  const userIds: string[] = [];
  const restaurantIds: string[] = [];
  const channels: Array<{ client: SupabaseClient; channel: RealtimeChannel }> = [];

  /** Подписка на booking_requests БЕЗ фильтра: так видно, пропускает ли чужое именно RLS, а не наш filter. */
  async function listen(client: SupabaseClient, name: string): Promise<Event[]> {
    const received: Event[] = [];
    const channel = client.channel(`probe-${name}-${runId}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "booking_requests" },
      (payload) => received.push({ eventType: payload.eventType, new: payload.new }),
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name}: подписка не стала SUBSCRIBED`)), 15_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    channels.push({ client, channel });
    return received;
  }

  async function signedIn(label: string): Promise<{ client: SupabaseClient; id: string }> {
    const email = `rt-${label}-${runId}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`setup user ${label}: ${created.error?.message}`);
    userIds.push(created.data.user.id);
    const client = createClient(url!, anonKey!, AUTH_OPTS);
    const res = await client.auth.signInWithPassword({ email, password });
    if (res.error) throw new Error(`sign in ${label}: ${res.error.message}`);
    // Realtime берёт токен из сессии клиента; явно передаём, чтобы не зависеть от порядка событий auth.
    client.realtime.setAuth(res.data.session.access_token);
    return { client, id: created.data.user.id };
  }

  async function restaurant(label: string): Promise<string> {
    const res = await service.from("restaurants").insert({ name: `rt-test-${label}-${runId}` }).select("id").single();
    if (res.error) throw new Error(`restaurant ${label}: ${res.error.message}`);
    restaurantIds.push(res.data.id);
    return res.data.id;
  }

  let restaurantA: string;
  let managerEvents: Event[];
  let otherManagerEvents: Event[];
  let outsiderEvents: Event[];
  let anonEvents: Event[];

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, AUTH_OPTS);
    restaurantA = await restaurant("A");
    const restaurantB = await restaurant("B");

    const manager = await signedIn("manager-a");
    const otherManager = await signedIn("manager-b");
    const outsider = await signedIn("outsider");
    const anon = createClient(url!, anonKey!, AUTH_OPTS);
    await service.from("restaurant_managers").insert({ user_id: manager.id, restaurant_id: restaurantA });
    await service.from("restaurant_managers").insert({ user_id: otherManager.id, restaurant_id: restaurantB });

    managerEvents = await listen(manager.client, "manager-a");
    otherManagerEvents = await listen(otherManager.client, "manager-b");
    outsiderEvents = await listen(outsider.client, "outsider");
    anonEvents = await listen(anon, "anon");
  }, 90_000);

  afterAll(async () => {
    for (const { client, channel } of channels) await client.removeChannel(channel);
    if (restaurantIds.length > 0) await service.from("restaurants").delete().in("id", restaurantIds);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  }, 60_000);

  it("менеджер получает INSERT и UPDATE своего ресторана; остальные — ничего; формат дат как у PostgREST", async () => {
    const inserted = await service
      .from("booking_requests")
      .insert({
        restaurant_id: restaurantA,
        guest_name: "rt",
        contact: "rt",
        booking_at: new Date(Date.now() + 86_400_000).toISOString(),
        guests_count: 2,
        idempotency_key: `rt-${runId}`,
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();
    const id = inserted.data!.id as string;

    await sleep(300); // updated_at ставит триггер: пауза, чтобы значения различались
    const updated = await service.from("booking_requests").update({ status: "confirmed" }).eq("id", id);
    expect(updated.error).toBeNull();

    // Ждём доставку (обычно < 1 с), потом ещё немного — чтобы «ничего не пришло» не было просто гонкой.
    const deadline = Date.now() + 10_000;
    while (managerEvents.filter((e) => e.new.id === id).length < 2 && Date.now() < deadline) await sleep(200);
    await sleep(2_000);

    // Только события нашей строки: параллельный RLS-тест тоже пишет в booking_requests (в своих ресторанах).
    const mine = managerEvents.filter((e) => e.new.id === id).map((e) => e.eventType);
    expect(mine).toEqual(["INSERT", "UPDATE"]);
    expect(dataEvents(otherManagerEvents)).toEqual([]);
    expect(dataEvents(outsiderEvents)).toEqual([]);
    expect(dataEvents(anonEvents)).toEqual([]);

    // Формат: сравниваем строковое представление события и ответа PostgREST (как строки, без Date).
    const rest = await (await createManagerRead()).from("booking_requests").select("updated_at, booking_at").eq("id", id).single();
    const last = managerEvents.filter((e) => e.new.id === id)[1]!.new;
    console.log("payload  :", { updated_at: last.updated_at, booking_at: last.booking_at });
    console.log("PostgREST:", rest.data);
    expect(last.updated_at).toBe(rest.data?.updated_at);
    expect(last.booking_at).toBe(rest.data?.booking_at);
  }, 60_000);

  /** Читает строку тем же способом, что админка (под менеджером A), а не service role. */
  async function createManagerRead(): Promise<SupabaseClient> {
    const email = `rt-read-${runId}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`read user: ${created.error?.message}`);
    userIds.push(created.data.user.id);
    await service.from("restaurant_managers").insert({ user_id: created.data.user.id, restaurant_id: restaurantA });
    const client = createClient(url!, anonKey!, AUTH_OPTS);
    const res = await client.auth.signInWithPassword({ email, password });
    if (res.error) throw new Error(`read sign in: ${res.error.message}`);
    return client;
  }
});
