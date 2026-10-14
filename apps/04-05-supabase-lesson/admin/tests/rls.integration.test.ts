// Интеграционный тест RLS против dev-БД (спека S04, §5 шаг 5 и 12).
// Проверяет защиту ЗАПРОСАМИ МИМО ИНТЕРФЕЙСА: аноним, посторонний пользователь, менеджер чужого ресторана.
//
// Запуск: pnpm test:admin. Ключи читаются из .env в корне приложения (vite.config.ts),
// без SUPABASE_SERVICE_ROLE_KEY весь файл пропускается. Ключ service role нужен ТОЛЬКО здесь —
// для подготовки данных; он не VITE_* и в бандл браузера не попадает (файл лежит вне src/).
//
// Тест создаёт два своих ресторана и три своих пользователя Auth (суффикс запуска в именах) и удаляет их в afterAll.
// Боту это не мешает: он берёт самый ранний ресторан, а тестовые создаются позже.
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

// Клиенты без сессии на диске и без фонового refresh: тест не должен оставлять таймеры.
const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Справочные таблицы: менеджер ресторана работает с ними через политики. */
const CATALOG_TABLES = ["restaurants", "faq_entries", "menu_categories", "menu_items"] as const;
/** Таблицы без политик для authenticated (чат — S06) + членство (читается только своя строка). */
const CLOSED_TABLES = ["conversations", "messages", "processed_updates"] as const;
/** Заявки: менеджер читает свои (S05), писать не может — статусы только через RPC. */
const REQUEST_TABLES = ["booking_requests", "guest_requests"] as const;
const ALL_TABLES = [...CATALOG_TABLES, "restaurant_managers", ...CLOSED_TABLES, ...REQUEST_TABLES];

const runId = Math.random().toString(36).slice(2, 8);
const TEST_UPDATE_ID = -Math.floor(Math.random() * 1_000_000_000) - 1; // отрицательный: не пересекается с настоящими

interface Fixture {
  restaurantId: string;
  faqId: string;
  categoryId: string;
  itemId: string;
}

describe.skipIf(!enabled)("RLS: справочники и закрытые таблицы", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let outsider: SupabaseClient;
  let managerA: SupabaseClient;
  let A: Fixture;
  let B: Fixture;
  const userIds: string[] = [];
  const restaurantIds: string[] = [];

  /** Достаёт data или падает с понятным текстом: ошибка подготовки данных — не провал проверки RLS. */
  function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
    if (result.error || result.data === null || result.data === undefined) {
      throw new Error(`${what}: ${result.error?.message ?? "нет данных"}`);
    }
    return result.data as NonNullable<T>;
  }

  async function createUser(label: string): Promise<SupabaseClient> {
    const email = `rls-${label}-${runId}@example.test`;
    const password = `pw-${crypto.randomUUID()}`; // случайный, нигде не сохраняется
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`setup: user ${label}: ${created.error?.message}`);
    userIds.push(created.data.user.id);
    const client = createClient(url!, anonKey!, AUTH_OPTS);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`setup: sign in ${label}: ${signedIn.error.message}`);
    // id нужен для привязки к ресторану
    (client as unknown as { userId: string }).userId = created.data.user.id;
    return client;
  }

  async function createFixture(label: string): Promise<Fixture> {
    const restaurant = must(
      await service.from("restaurants").insert({ name: `rls-test-${label}-${runId}` }).select("id").single(),
      `restaurant ${label}`,
    );
    restaurantIds.push(restaurant.id);
    const rid = restaurant.id;
    const faq = must(
      await service.from("faq_entries").insert({ restaurant_id: rid, question: "q", answer: "a" }).select("id").single(),
      "faq",
    );
    const category = must(
      await service.from("menu_categories").insert({ restaurant_id: rid, name: "c" }).select("id").single(),
      "category",
    );
    const item = must(
      await service.from("menu_items").insert({ restaurant_id: rid, name: "i", price: 1 }).select("id").single(),
      "item",
    );
    // Строки закрытых таблиц: пустая выдача имеет смысл только если данные в них есть.
    const conversation = must(
      await service
        .from("conversations")
        .insert({ restaurant_id: rid, external_user_id: TEST_UPDATE_ID - restaurantIds.length, chat_id: -1 })
        .select("id")
        .single(),
      "conversation",
    );
    must(
      await service.from("messages").insert({ conversation_id: conversation.id, direction: "in", text: "hi" }).select("id").single(),
      "message",
    );
    must(
      await service
        .from("booking_requests")
        .insert({
          restaurant_id: rid,
          guest_name: "t",
          contact: "t",
          booking_at: new Date(Date.now() + 86_400_000).toISOString(),
          guests_count: 2,
          idempotency_key: `rls-booking-${label}-${runId}`,
        })
        .select("id")
        .single(),
      "booking",
    );
    must(
      await service
        .from("guest_requests")
        .insert({ restaurant_id: rid, kind: "feedback", text: "t", idempotency_key: `rls-guest-${label}-${runId}` })
        .select("id")
        .single(),
      "guest request",
    );
    return { restaurantId: rid, faqId: faq.id, categoryId: category.id, itemId: item.id };
  }

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, AUTH_OPTS);
    anon = createClient(url!, anonKey!, AUTH_OPTS);
    A = await createFixture("A");
    B = await createFixture("B");
    must(await service.from("processed_updates").insert({ update_id: TEST_UPDATE_ID }).select().single(), "processed_update");

    managerA = await createUser("manager-a");
    outsider = await createUser("outsider");
    const managerId = (managerA as unknown as { userId: string }).userId;
    must(
      await service.from("restaurant_managers").insert({ user_id: managerId, restaurant_id: A.restaurantId }).select().single(),
      "membership",
    );
  }, 60_000);

  afterAll(async () => {
    // Рестораны удаляются каскадом: вместе с FAQ, меню, диалогами, заявками и членством.
    if (restaurantIds.length > 0) await service.from("restaurants").delete().in("id", restaurantIds);
    await service.from("processed_updates").delete().eq("update_id", TEST_UPDATE_ID);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  }, 60_000);

  /** Сколько строк таблицы видит клиент. Отказ в доступе (ошибка) = 0 строк. */
  async function visibleRows(client: SupabaseClient, table: string): Promise<number> {
    const { data, error } = await client.from(table).select("*");
    return error ? 0 : (data?.length ?? 0);
  }

  /** Строка в таблице на самом деле (смотрим service role'ом, а не тем, кого проверяем). */
  async function rowExists(table: string, id: string): Promise<boolean> {
    const { data } = await service.from(table).select("id").eq("id", id).maybeSingle();
    return data !== null;
  }

  describe("аноним (anon-ключ, без токена)", () => {
    it.each(ALL_TABLES)("не видит строк в %s", async (table) => {
      expect(await visibleRows(anon, table)).toBe(0);
    });

    it("не может писать в справочники", async () => {
      const faq = await anon.from("faq_entries").insert({ restaurant_id: A.restaurantId, question: "x", answer: "x" });
      expect(faq.error).not.toBeNull();
      const item = await anon.from("menu_items").insert({ restaurant_id: A.restaurantId, name: "x", price: 1 });
      expect(item.error).not.toBeNull();
    });

    it("не может менять и удалять", async () => {
      await anon.from("restaurants").update({ name: "hacked" }).eq("id", A.restaurantId);
      await anon.from("faq_entries").delete().eq("id", A.faqId);
      const { data: restaurant } = await service.from("restaurants").select("name").eq("id", A.restaurantId).single();
      expect(restaurant?.name).toBe(`rls-test-A-${runId}`);
      expect(await rowExists("faq_entries", A.faqId)).toBe(true);
    });
  });

  describe("посторонний (вошёл, но не менеджер)", () => {
    it.each(ALL_TABLES)("не видит строк в %s", async (table) => {
      expect(await visibleRows(outsider, table)).toBe(0);
    });

    it("не может писать в справочники", async () => {
      const res = await outsider.from("faq_entries").insert({ restaurant_id: A.restaurantId, question: "x", answer: "x" });
      expect(res.error).not.toBeNull();
    });

    it("не может менять и удалять чужое", async () => {
      await outsider.from("restaurants").update({ name: "hacked" }).eq("id", A.restaurantId);
      await outsider.from("menu_items").delete().eq("id", A.itemId);
      const { data: restaurant } = await service.from("restaurants").select("name").eq("id", A.restaurantId).single();
      expect(restaurant?.name).toBe(`rls-test-A-${runId}`);
      expect(await rowExists("menu_items", A.itemId)).toBe(true);
    });

    it("не может выдать себе членство", async () => {
      const userId = (outsider as unknown as { userId: string }).userId;
      const res = await outsider.from("restaurant_managers").insert({ user_id: userId, restaurant_id: A.restaurantId });
      expect(res.error).not.toBeNull();
    });
  });

  describe("менеджер ресторана A", () => {
    it("видит только свой ресторан и его справочники", async () => {
      const restaurants = must(await managerA.from("restaurants").select("id"), "select restaurants");
      expect(restaurants.map((r) => r.id)).toEqual([A.restaurantId]);
      for (const table of ["faq_entries", "menu_categories", "menu_items"]) {
        const rows = must(await managerA.from(table).select("restaurant_id"), table);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.restaurant_id === A.restaurantId)).toBe(true);
      }
    });

    it("видит только свою строку членства", async () => {
      const rows = must(await managerA.from("restaurant_managers").select("*"), "select managers");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.restaurant_id).toBe(A.restaurantId);
    });

    it("не видит чат (политик нет до S06), хотя данные в нём есть", async () => {
      for (const table of CLOSED_TABLES) expect(await visibleRows(managerA, table)).toBe(0);
      // данные действительно существуют — иначе проверка выше ничего бы не доказывала
      expect(await visibleRows(service, "conversations")).toBeGreaterThan(0);
    });

    it("видит заявки только своего ресторана, не чужого", async () => {
      for (const table of REQUEST_TABLES) {
        const rows = must(await managerA.from(table).select("restaurant_id"), table);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.restaurant_id === A.restaurantId)).toBe(true);
      }
    });

    it("не меняет статус заявки напрямую (только через RPC)", async () => {
      await managerA.from("booking_requests").update({ status: "confirmed" }).eq("restaurant_id", A.restaurantId);
      await managerA.from("guest_requests").update({ status: "resolved" }).eq("restaurant_id", A.restaurantId);
      const booking = must(await service.from("booking_requests").select("status").eq("restaurant_id", A.restaurantId), "booking");
      const guest = must(await service.from("guest_requests").select("status").eq("restaurant_id", A.restaurantId), "guest");
      expect(booking.every((r) => r.status === "pending")).toBe(true);
      expect(guest.every((r) => r.status === "new")).toBe(true);
    });

    it("не может создавать и удалять заявки", async () => {
      const res = await managerA
        .from("guest_requests")
        .insert({ restaurant_id: A.restaurantId, kind: "feedback", text: "x", idempotency_key: `rls-x-${runId}` });
      expect(res.error).not.toBeNull();
      await managerA.from("booking_requests").delete().eq("restaurant_id", A.restaurantId);
      expect(await visibleRows(service, "booking_requests")).toBeGreaterThan(0);
    });

    it("полный CRUD по своим справочникам", async () => {
      const faq = must(
        await managerA.from("faq_entries").insert({ restaurant_id: A.restaurantId, question: "q2", answer: "a2" }).select().single(),
        "insert faq",
      );
      const updated = must(await managerA.from("faq_entries").update({ answer: "a3" }).eq("id", faq.id).select().single(), "update faq");
      expect(updated.answer).toBe("a3");
      const removed = must(await managerA.from("faq_entries").delete().eq("id", faq.id).select(), "delete faq");
      expect(removed).toHaveLength(1);

      const category = must(
        await managerA.from("menu_categories").insert({ restaurant_id: A.restaurantId, name: "c2" }).select().single(),
        "insert category",
      );
      const item = must(
        await managerA
          .from("menu_items")
          .insert({ restaurant_id: A.restaurantId, category_id: category.id, name: "i2", price: 0 })
          .select()
          .single(),
        "insert item",
      );
      expect(item.price).toBe(0);
      must(await managerA.from("menu_items").delete().eq("id", item.id).select(), "delete item");
      must(await managerA.from("menu_categories").delete().eq("id", category.id).select(), "delete category");
    });

    it("может править свой ресторан", async () => {
      const res = must(
        await managerA.from("restaurants").update({ address: "ул. Тестовая" }).eq("id", A.restaurantId).select().single(),
        "update restaurant",
      );
      expect(res.address).toBe("ул. Тестовая");
    });

    it("не может создать запись в чужом ресторане (with check)", async () => {
      const faq = await managerA.from("faq_entries").insert({ restaurant_id: B.restaurantId, question: "x", answer: "x" });
      expect(faq.error).not.toBeNull();
      const cat = await managerA.from("menu_categories").insert({ restaurant_id: B.restaurantId, name: "x" });
      expect(cat.error).not.toBeNull();
      const item = await managerA.from("menu_items").insert({ restaurant_id: B.restaurantId, name: "x", price: 1 });
      expect(item.error).not.toBeNull();
    });

    it("не может перенести свою запись в чужой ресторан сменой restaurant_id", async () => {
      const res = await managerA.from("faq_entries").update({ restaurant_id: B.restaurantId }).eq("id", A.faqId);
      expect(res.error).not.toBeNull();
      const { data } = await service.from("faq_entries").select("restaurant_id").eq("id", A.faqId).single();
      expect(data?.restaurant_id).toBe(A.restaurantId);
    });

    it("не может менять и удалять чужое: строки остаются нетронутыми", async () => {
      await managerA.from("faq_entries").update({ answer: "hacked" }).eq("id", B.faqId);
      await managerA.from("menu_items").update({ price: 999 }).eq("id", B.itemId);
      await managerA.from("restaurants").update({ name: "hacked" }).eq("id", B.restaurantId);
      await managerA.from("faq_entries").delete().eq("id", B.faqId);
      await managerA.from("menu_categories").delete().eq("id", B.categoryId);
      await managerA.from("menu_items").delete().eq("id", B.itemId);

      expect(await rowExists("faq_entries", B.faqId)).toBe(true);
      expect(await rowExists("menu_categories", B.categoryId)).toBe(true);
      expect(await rowExists("menu_items", B.itemId)).toBe(true);
      const faq = await service.from("faq_entries").select("answer").eq("id", B.faqId).single();
      expect(faq.data?.answer).toBe("a");
      const item = await service.from("menu_items").select("price").eq("id", B.itemId).single();
      expect(item.data?.price).toBe(1);
      const restaurant = await service.from("restaurants").select("name").eq("id", B.restaurantId).single();
      expect(restaurant.data?.name).toBe(`rls-test-B-${runId}`);
    });

    it("не может создавать и удалять рестораны", async () => {
      const created = await managerA.from("restaurants").insert({ name: `rls-test-evil-${runId}` });
      expect(created.error).not.toBeNull();
      await managerA.from("restaurants").delete().eq("id", A.restaurantId);
      expect(await rowExists("restaurants", A.restaurantId)).toBe(true);
    });

    it("не может менять собственное членство", async () => {
      const userId = (managerA as unknown as { userId: string }).userId;
      const moved = await managerA.from("restaurant_managers").update({ restaurant_id: B.restaurantId }).eq("user_id", userId);
      expect(moved.error).toBeNull(); // политики на update нет → 0 строк, не ошибка
      await managerA.from("restaurant_managers").delete().eq("user_id", userId);
      const { data } = await service.from("restaurant_managers").select("restaurant_id").eq("user_id", userId).single();
      expect(data?.restaurant_id).toBe(A.restaurantId);
    });
  });
});
