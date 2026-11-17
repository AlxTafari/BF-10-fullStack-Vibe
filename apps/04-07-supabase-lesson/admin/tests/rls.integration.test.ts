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
import { EU_ALLERGEN_CODES } from "../src/domain/allergens";
// Справочник бота — тот же список в другой сборке (Deno). Файл без зависимостей, Vite импортирует его как обычный TS.
import { EU_ALLERGEN_CODES as BOT_ALLERGEN_CODES } from "../../supabase/functions/_shared/domain/allergens";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

// Клиенты без сессии на диске и без фонового refresh: тест не должен оставлять таймеры.
const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Справочные таблицы: менеджер ресторана работает с ними через политики. */
const CATALOG_TABLES = ["restaurants", "faq_entries", "menu_categories", "menu_items"] as const;
/** Таблицы без политик для authenticated + членство (читается только своя строка). */
const CLOSED_TABLES = ["processed_updates"] as const;
/** Чат: менеджер читает диалоги и сообщения своего ресторана (S06), писать не может — журнал пишет бот. Подробно — chat.integration.test.ts. */
const CHAT_TABLES = ["conversations", "messages"] as const;
/** Заявки: менеджер читает свои (S05), писать не может — статусы только через RPC. */
const REQUEST_TABLES = ["booking_requests", "guest_requests"] as const;
/** Настройки AI (S09): менеджер читает и правит свою строку, создаёт и удаляет её только БД. */
const SETTINGS_TABLES = ["restaurant_ai_settings"] as const;
/** База знаний (S10): документы и блюда подборок — менеджер через политики; чанки закрыты, их пишет service role. */
const KNOWLEDGE_TABLES = ["knowledge_documents", "knowledge_document_dishes", "knowledge_chunks"] as const;
const ALL_TABLES = [
  ...CATALOG_TABLES,
  "restaurant_managers",
  ...CLOSED_TABLES,
  ...CHAT_TABLES,
  ...REQUEST_TABLES,
  ...SETTINGS_TABLES,
  ...KNOWLEDGE_TABLES,
];

const runId = Math.random().toString(36).slice(2, 8);
const TEST_UPDATE_ID = -Math.floor(Math.random() * 1_000_000_000) - 1; // отрицательный: не пересекается с настоящими

interface Fixture {
  restaurantId: string;
  faqId: string;
  categoryId: string;
  itemId: string;
  /** Опубликованная подборка с блюдом itemId и одним чанком. */
  documentId: string;
}

/** Вектор размерности схемы (768). Значение неважно: тест проверяет доступ, а не поиск. */
const FAKE_EMBEDDING = Array.from({ length: 768 }, () => 0.01);

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
    const document = must(
      await service
        .from("knowledge_documents")
        .insert({ restaurant_id: rid, title: "d", body: "b", type: "collection", is_published: true })
        .select("id")
        .single(),
      "knowledge document",
    );
    must(
      await service
        .from("knowledge_document_dishes")
        .insert({ document_id: document.id, menu_item_id: item.id, restaurant_id: rid })
        .select("document_id")
        .single(),
      "knowledge document dish",
    );
    must(
      await service
        .from("knowledge_chunks")
        .insert({ restaurant_id: rid, document_id: document.id, chunk_index: 0, content: "d. b", embedding: FAKE_EMBEDDING })
        .select("id")
        .single(),
      "knowledge chunk",
    );
    return { restaurantId: rid, faqId: faq.id, categoryId: category.id, itemId: item.id, documentId: document.id };
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

    it("не видит закрытые таблицы (processed_updates), хотя данные в них могут быть", async () => {
      for (const table of CLOSED_TABLES) expect(await visibleRows(managerA, table)).toBe(0);
    });

    it("видит диалоги и сообщения только своего ресторана, не чужого", async () => {
      const conversations = must(await managerA.from("conversations").select("restaurant_id"), "conversations");
      expect(conversations.length).toBeGreaterThan(0);
      expect(conversations.every((r) => r.restaurant_id === A.restaurantId)).toBe(true);
      expect(await visibleRows(managerA, "messages")).toBeGreaterThan(0);
      // чужие диалоги существуют (данные есть), но менеджер A их не получает
      const foreign = must(await service.from("conversations").select("id").eq("restaurant_id", B.restaurantId), "foreign conversations");
      expect(foreign.length).toBeGreaterThan(0);
      const seen = must(await managerA.from("conversations").select("id").in("id", foreign.map((r) => r.id)), "foreign visible");
      expect(seen).toEqual([]);
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

    it("настройки AI: строка создана вместе с рестораном, значения по умолчанию, видна только своя", async () => {
      const rows = must(await managerA.from("restaurant_ai_settings").select("*"), "select ai settings");
      expect(rows).toEqual([{ restaurant_id: A.restaurantId, ai_enabled: true, history_window: 12, daily_turn_limit: 50 }]);
    });

    it("настройки AI: правит свои в пределах check, вне диапазона — отказ БД", async () => {
      const updated = must(
        await managerA
          .from("restaurant_ai_settings")
          .update({ ai_enabled: false, history_window: 20, daily_turn_limit: 100 })
          .eq("restaurant_id", A.restaurantId)
          .select()
          .single(),
        "update ai settings",
      );
      expect(updated).toMatchObject({ ai_enabled: false, history_window: 20, daily_turn_limit: 100 });

      for (const patch of [{ history_window: 3 }, { history_window: 31 }, { daily_turn_limit: 4 }, { daily_turn_limit: 501 }]) {
        const res = await managerA.from("restaurant_ai_settings").update(patch).eq("restaurant_id", A.restaurantId);
        expect(res.error, JSON.stringify(patch)).not.toBeNull();
      }
    });

    it("настройки AI: чужие не меняются, создать и удалить нельзя", async () => {
      await managerA.from("restaurant_ai_settings").update({ ai_enabled: false }).eq("restaurant_id", B.restaurantId);
      const foreign = must(
        await service.from("restaurant_ai_settings").select("ai_enabled").eq("restaurant_id", B.restaurantId).single(),
        "foreign ai settings",
      );
      expect(foreign.ai_enabled).toBe(true);

      const moved = await managerA
        .from("restaurant_ai_settings")
        .update({ restaurant_id: B.restaurantId })
        .eq("restaurant_id", A.restaurantId);
      expect(moved.error).not.toBeNull(); // with check: перенос в чужой ресторан

      // Политик на insert и delete нет: строку создаёт триггер, удаляет каскад вместе с рестораном.
      const inserted = await managerA.from("restaurant_ai_settings").insert({ restaurant_id: A.restaurantId });
      expect(inserted.error).not.toBeNull();
      await managerA.from("restaurant_ai_settings").delete().eq("restaurant_id", A.restaurantId);
      const own = await service.from("restaurant_ai_settings").select("restaurant_id").eq("restaurant_id", A.restaurantId);
      expect(own.data).toHaveLength(1);
    });

    it("аллергены: только коды справочника ЕС, свободный текст отклоняет БД", async () => {
      const bad = await managerA.from("menu_items").update({ allergens: ["орехи"] }).eq("id", A.itemId);
      expect(bad.error).not.toBeNull();
      const good = must(
        await managerA.from("menu_items").update({ allergens: ["nuts", "milk"] }).eq("id", A.itemId).select("allergens").single(),
        "allergens codes",
      );
      expect(good.allergens).toEqual(["nuts", "milk"]);
      // null («не указано») и [] («нет») по-прежнему допустимы
      expect((await managerA.from("menu_items").update({ allergens: null }).eq("id", A.itemId)).error).toBeNull();
      expect((await managerA.from("menu_items").update({ allergens: [] }).eq("id", A.itemId)).error).toBeNull();
    });

    it("справочник аллергенов одинаков в БД, админке и боте", async () => {
      const db = must(await managerA.rpc("eu_allergen_codes"), "eu_allergen_codes");
      expect(db).toEqual([...EU_ALLERGEN_CODES]);
      expect([...BOT_ALLERGEN_CODES]).toEqual([...EU_ALLERGEN_CODES]);
    });
  });

  describe("база знаний (S10)", () => {
    /** Служебные поля индексации, как их видит БД (service role). */
    async function indexFields(table: "knowledge_documents" | "menu_items", id: string) {
      return must(
        await service
          .from(table)
          .select("index_status, index_revision, indexed_revision, index_attempt, index_error, indexed_at")
          .eq("id", id)
          .single(),
        `index fields ${table}`,
      );
    }

    async function chunkCount(documentId: string): Promise<number> {
      const { count } = await service.from("knowledge_chunks").select("id", { count: "exact", head: true }).eq("document_id", documentId);
      return count ?? 0;
    }

    async function linkedItems(documentId: string): Promise<string[]> {
      const { data } = await service
        .from("knowledge_document_dishes")
        .select("menu_item_id")
        .eq("document_id", documentId)
        .order("sort_order");
      return (data ?? []).map((r) => r.menu_item_id as string);
    }

    /** Документ ресторана A для теста, который его портит; удаляется вместе с рестораном. */
    async function ownDocument(overrides: Record<string, unknown> = {}): Promise<string> {
      const doc = must(
        await service
          .from("knowledge_documents")
          .insert({ restaurant_id: A.restaurantId, title: "t", body: "b", type: "collection", is_published: true, ...overrides })
          .select("id")
          .single(),
        "own document",
      );
      return doc.id;
    }

    it("менеджер видит документы и блюда подборок только своего ресторана, чанки — ничьи", async () => {
      const docs = must(await managerA.from("knowledge_documents").select("id, restaurant_id"), "documents");
      expect(docs.length).toBeGreaterThan(0);
      expect(docs.every((d) => d.restaurant_id === A.restaurantId)).toBe(true);
      const links = must(await managerA.from("knowledge_document_dishes").select("restaurant_id"), "links");
      expect(links.length).toBeGreaterThan(0);
      expect(links.every((l) => l.restaurant_id === A.restaurantId)).toBe(true);
      // Чанк у A есть (создан в фикстуре), но менеджеру таблица закрыта целиком.
      expect(await chunkCount(A.documentId)).toBe(1);
      expect(await visibleRows(managerA, "knowledge_chunks")).toBe(0);
    });

    it("менеджер не пишет и не удаляет чанки напрямую", async () => {
      const inserted = await managerA.from("knowledge_chunks").insert({
        restaurant_id: A.restaurantId,
        document_id: A.documentId,
        chunk_index: 1,
        content: "x",
        embedding: FAKE_EMBEDDING,
      });
      expect(inserted.error).not.toBeNull();
      await managerA.from("knowledge_chunks").delete().eq("document_id", A.documentId);
      expect(await chunkCount(A.documentId)).toBe(1);
    });

    it("чужой ресторан: документы не меняются и не удаляются, в чужой ресторан не создать", async () => {
      await managerA.from("knowledge_documents").update({ title: "hacked" }).eq("id", B.documentId);
      await managerA.from("knowledge_documents").delete().eq("id", B.documentId);
      const doc = must(await service.from("knowledge_documents").select("title").eq("id", B.documentId).single(), "B doc");
      expect(doc.title).toBe("d");
      const foreign = await managerA
        .from("knowledge_documents")
        .insert({ restaurant_id: B.restaurantId, title: "x", body: "x", type: "other" });
      expect(foreign.error).not.toBeNull();
    });

    it("чужое блюдо нельзя привязать к своей подборке ни напрямую, ни через RPC", async () => {
      // restaurant_id = A: составной FK не находит блюдо B в ресторане A.
      const asOwn = await managerA
        .from("knowledge_document_dishes")
        .insert({ document_id: A.documentId, menu_item_id: B.itemId, restaurant_id: A.restaurantId });
      expect(asOwn.error).not.toBeNull();
      // restaurant_id = B: не проходит with check политики.
      const asForeign = await managerA
        .from("knowledge_document_dishes")
        .insert({ document_id: A.documentId, menu_item_id: B.itemId, restaurant_id: B.restaurantId });
      expect(asForeign.error).not.toBeNull();
      const viaRpc = await managerA.rpc("save_knowledge_document", {
        p_id: A.documentId,
        p_title: "d",
        p_body: "b",
        p_type: "collection",
        p_is_published: true,
        p_dish_ids: [B.itemId],
      });
      expect(viaRpc.error?.message).toBe("invalid_dishes");
      expect(await linkedItems(A.documentId)).toEqual([A.itemId]);
    });

    it("служебные поля индексации менеджер не подменяет: ни при создании, ни прямым update", async () => {
      const created = must(
        await managerA
          .from("knowledge_documents")
          .insert({
            restaurant_id: A.restaurantId,
            title: "t",
            body: "b",
            type: "other",
            index_status: "ready",
            index_revision: 50,
            indexed_revision: 50,
          })
          .select("id")
          .single(),
        "manager insert",
      );
      expect(await indexFields("knowledge_documents", created.id)).toMatchObject({
        index_status: "pending",
        index_revision: 1,
        indexed_revision: null,
      });

      const before = await indexFields("menu_items", A.itemId);
      await managerA
        .from("menu_items")
        .update({ index_status: "ready", indexed_revision: before.index_revision, index_attempt: crypto.randomUUID() })
        .eq("id", A.itemId);
      expect(await indexFields("menu_items", A.itemId)).toEqual(before);
    });

    it("правка содержимого — новая версия и «ожидает»; цена и стоп-лист версию не меняют", async () => {
      // Имитация успешной индексации: service role (как будущий индексатор) выставляет ready.
      const docId = await ownDocument();
      must(
        await service
          .from("knowledge_documents")
          .update({ index_status: "ready", indexed_revision: 1, indexed_at: new Date().toISOString() })
          .eq("id", docId)
          .select("id")
          .single(),
        "mark ready",
      );
      await managerA.from("knowledge_documents").update({ body: "новый текст" }).eq("id", docId);
      expect(await indexFields("knowledge_documents", docId)).toMatchObject({
        index_status: "pending",
        index_revision: 2,
        indexed_revision: 1, // последняя успешная индексация остаётся — по ней видно, что индекс устарел
      });

      const item = await indexFields("menu_items", A.itemId);
      await managerA.from("menu_items").update({ price: 99, is_available: false, allergens: ["fish"] }).eq("id", A.itemId);
      expect((await indexFields("menu_items", A.itemId)).index_revision).toBe(item.index_revision);
      await managerA.from("menu_items").update({ description: "новое описание" }).eq("id", A.itemId);
      expect((await indexFields("menu_items", A.itemId)).index_revision).toBe(item.index_revision + 1);
    });

    it("переименование категории инвалидирует её блюда", async () => {
      must(
        await service.from("menu_items").update({ category_id: A.categoryId }).eq("id", A.itemId).select("id").single(),
        "item to category",
      );
      const before = await indexFields("menu_items", A.itemId);
      await managerA.from("menu_categories").update({ name: `c-${runId}` }).eq("id", A.categoryId);
      expect(await indexFields("menu_items", A.itemId)).toMatchObject({
        index_status: "pending",
        index_revision: before.index_revision + 1,
      });
    });

    it("снятие с публикации сразу удаляет чанки; смена типа с подборки удаляет связи", async () => {
      const docId = await ownDocument();
      must(
        await service
          .from("knowledge_chunks")
          .insert({ restaurant_id: A.restaurantId, document_id: docId, chunk_index: 0, content: "t. b", embedding: FAKE_EMBEDDING })
          .select("id")
          .single(),
        "chunk",
      );
      must(
        await service
          .from("knowledge_document_dishes")
          .insert({ document_id: docId, menu_item_id: A.itemId, restaurant_id: A.restaurantId })
          .select("document_id")
          .single(),
        "link",
      );
      await managerA.from("knowledge_documents").update({ is_published: false }).eq("id", docId);
      expect(await chunkCount(docId)).toBe(0);
      await managerA.from("knowledge_documents").update({ type: "drinks" }).eq("id", docId);
      expect(await linkedItems(docId)).toEqual([]);
      // Связь у не-подборки не создать даже напрямую.
      const link = await managerA
        .from("knowledge_document_dishes")
        .insert({ document_id: docId, menu_item_id: A.itemId, restaurant_id: A.restaurantId });
      expect(link.error).not.toBeNull();
    });

    it("RPC сохраняет документ и состав подборки вместе, порядок блюд — порядок массива", async () => {
      const second = must(
        await service.from("menu_items").insert({ restaurant_id: A.restaurantId, name: "i2", price: 2 }).select("id").single(),
        "second item",
      );
      const id = must(
        await managerA.rpc("save_knowledge_document", {
          p_id: null,
          p_title: "  Подборка  ",
          p_body: "тема",
          p_type: "collection",
          p_is_published: true,
          p_dish_ids: [second.id, A.itemId],
        }),
        "rpc create",
      ) as string;
      const doc = must(await service.from("knowledge_documents").select("title, restaurant_id").eq("id", id).single(), "created");
      expect(doc).toEqual({ title: "Подборка", restaurant_id: A.restaurantId });
      expect(await linkedItems(id)).toEqual([second.id, A.itemId]);

      // Ошибка — откат целиком: документ не меняется, связи прежние.
      const bad = await managerA.rpc("save_knowledge_document", {
        p_id: id,
        p_title: "Другое",
        p_body: "тема",
        p_type: "other",
        p_is_published: true,
        p_dish_ids: [A.itemId],
      });
      expect(bad.error?.message).toBe("dishes_only_for_collection");
      expect((await service.from("knowledge_documents").select("title").eq("id", id).single()).data?.title).toBe("Подборка");
      expect(await linkedItems(id)).toEqual([second.id, A.itemId]);
    });

    it("RPC: чужой документ не найден; посторонний и аноним не сохраняют", async () => {
      const args = { p_title: "x", p_body: "x", p_type: "other", p_is_published: false, p_dish_ids: [] };
      const foreign = await managerA.rpc("save_knowledge_document", { p_id: B.documentId, ...args });
      expect(foreign.error?.message).toBe("not_found");
      const byOutsider = await outsider.rpc("save_knowledge_document", { p_id: null, ...args });
      expect(byOutsider.error?.message).toBe("not_found");
      const byAnon = await anon.rpc("save_knowledge_document", { p_id: null, ...args });
      expect(byAnon.error).not.toBeNull();
    });
  });
});
