// Интеграционные проверки чата на dev-БД (спека S06, шаги 15–17 приёмки). Что проверяем:
//  1. курсорный обход RPC get_messages_page на ничьих created_at: каждая строка ровно один раз, в порядке;
//     «pageSize + 1»: количество, кратное размеру страницы, не даёт пустую последнюю страницу;
//  2. RLS: чужой менеджер, посторонний и аноним не читают ни диалоги, ни сообщения, ни через RPC;
//  3. запись клиентом запрещена (insert / update / delete); единственная запись — mark_conversation_read;
//  4. триггер последнего сообщения (в т.ч. не по порядку), unread_count, потолок 100, монотонность отметки;
//  5. Realtime: свой менеджер получает INSERT сообщения и UPDATE диалога, чужой — нет; формат метки = как у RPC.
// Запуск: pnpm test (нужны SUPABASE_* в .env корня; без них файл пропускается). Данные свои, чистятся в afterAll.
import { type RealtimeChannel, type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Cursor, buildPage, compareDesc, compareTimestamptz } from "../src/domain/cursor";
import { type Message, keyOfMessage } from "../src/domain/messages";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const runId = Math.random().toString(36).slice(2, 8);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Сгенерированные типы не знают, что курсор первой страницы — null. */
const nul = null as unknown as string;

interface Seed {
  direction: "in" | "out";
  kind?: "text" | "button";
  text: string;
  created_at: string;
}

describe.skipIf(!enabled)("Чат: курсор, RLS, триггер, непрочитанные, Realtime", () => {
  let service: SupabaseClient;
  const userIds: string[] = [];
  const restaurantIds: string[] = [];
  const channels: Array<{ client: SupabaseClient; channel: RealtimeChannel }> = [];

  let restaurantA: string;
  let restaurantB: string;
  let managerA: SupabaseClient;
  let managerB: SupabaseClient;
  let outsider: SupabaseClient;
  let anon: SupabaseClient;

  async function signedIn(label: string): Promise<{ client: SupabaseClient; id: string }> {
    const email = `chat-${label}-${runId}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`setup user ${label}: ${created.error?.message}`);
    userIds.push(created.data.user.id);
    const client = createClient(url!, anonKey!, AUTH_OPTS);
    const res = await client.auth.signInWithPassword({ email, password });
    if (res.error) throw new Error(`sign in ${label}: ${res.error.message}`);
    client.realtime.setAuth(res.data.session.access_token);
    return { client, id: created.data.user.id };
  }

  async function restaurant(label: string): Promise<string> {
    const res = await service.from("restaurants").insert({ name: `chat-test-${label}-${runId}` }).select("id").single();
    if (res.error) throw new Error(`restaurant ${label}: ${res.error.message}`);
    restaurantIds.push(res.data.id);
    return res.data.id;
  }

  let userCounter = 0;
  async function conversation(restaurantId: string): Promise<string> {
    userCounter += 1;
    const res = await service
      .from("conversations")
      .insert({ restaurant_id: restaurantId, external_user_id: -(userCounter + Date.now() % 100000), chat_id: -userCounter, display_name: `chat-test ${userCounter}` })
      .select("id")
      .single();
    if (res.error) throw new Error(`conversation: ${res.error.message}`);
    return res.data.id;
  }

  async function addMessages(conversationId: string, rows: Seed[]): Promise<void> {
    const res = await service.from("messages").insert(rows.map((r) => ({ conversation_id: conversationId, kind: "text", ...r })));
    if (res.error) throw new Error(`messages: ${res.error.message}`);
  }

  async function conversationRow(id: string) {
    const res = await service.from("conversations").select("*").eq("id", id).single();
    if (res.error) throw new Error(res.error.message);
    return res.data;
  }

  /** Весь диалог страницами по RPC (как это делает админка): pageSize + 1 → buildPage. */
  async function walk(client: SupabaseClient, conversationId: string, pageSize: number) {
    const seen: Message[] = [];
    let cursor = null as Cursor | null;
    let pages = 0;
    while (pages < 50) {
      const res = await client.rpc("get_messages_page", {
        p_conversation_id: conversationId,
        p_before_created_at: cursor?.at ?? nul,
        p_before_id: cursor?.id ?? nul,
        p_limit: pageSize + 1,
      });
      if (res.error) throw new Error(res.error.message);
      pages += 1;
      const page = buildPage(res.data as Message[], pageSize, keyOfMessage);
      seen.push(...page.rows);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return { seen, pages };
  }

  let convA: string; // 14 сообщений, ничьи по 5
  let tied: Seed[];

  beforeAll(async () => {
    service = createClient(url!, serviceKey!, AUTH_OPTS);
    restaurantA = await restaurant("A");
    restaurantB = await restaurant("B");
    const a = await signedIn("manager-a");
    const b = await signedIn("manager-b");
    const o = await signedIn("outsider");
    managerA = a.client;
    managerB = b.client;
    outsider = o.client;
    anon = createClient(url!, anonKey!, AUTH_OPTS);
    await service.from("restaurant_managers").insert({ user_id: a.id, restaurant_id: restaurantA });
    await service.from("restaurant_managers").insert({ user_id: b.id, restaurant_id: restaurantB });

    convA = await conversation(restaurantA);
    // 14 сообщений: метки сгруппированы по 5 (5 + 5 + 4), с микросекундами.
    tied = Array.from({ length: 14 }, (_, i) => ({
      direction: i % 2 === 0 ? "in" : "out",
      text: `№${i + 1}`,
      created_at: `2026-01-01T10:${String(Math.floor(i / 5)).padStart(2, "0")}:00.123456+00:00`,
    }));
    await addMessages(convA, tied);
  }, 90_000);

  afterAll(async () => {
    for (const { client, channel } of channels) await client.removeChannel(channel);
    if (restaurantIds.length > 0) await service.from("restaurants").delete().in("id", restaurantIds);
    for (const id of userIds) await service.auth.admin.deleteUser(id);
  }, 60_000);

  describe("курсор (инвариант 1–2)", () => {
    it("обход страницами по 4 при ничьих по 5: каждая строка один раз, в порядке created_at ↓, id ↓", async () => {
      const { seen } = await walk(managerA, convA, 4);
      expect(seen).toHaveLength(14);
      expect(new Set(seen.map((m) => m.id)).size).toBe(14);
      const sorted = [...seen].sort((x, y) => compareDesc(keyOfMessage(x), keyOfMessage(y)));
      expect(seen.map((m) => m.id)).toEqual(sorted.map((m) => m.id));
      expect(seen.map((m) => m.text).sort()).toEqual(tied.map((t) => t.text).sort());
    });

    it("количество кратно размеру страницы (14 = 2×7): ровно две страницы, пустой третьей нет", async () => {
      const { seen, pages } = await walk(managerA, convA, 7);
      expect(seen).toHaveLength(14);
      expect(pages).toBe(2);
    });

    it("метка с микросекундами приходит из RPC без потерь", async () => {
      const first = await managerA.rpc("get_messages_page", { p_conversation_id: convA, p_before_created_at: nul, p_before_id: nul, p_limit: 1 });
      expect(first.data?.[0]?.created_at).toBe("2026-01-01T10:02:00.123456+00:00");
    });
  });

  describe("RLS: чужие диалоги недоступны (инвариант 5)", () => {
    it("чужой менеджер, посторонний и аноним не видят ни диалог, ни сообщения", async () => {
      for (const [label, client] of [["чужой менеджер", managerB], ["посторонний", outsider], ["аноним", anon]] as const) {
        const conv = await client.from("conversations").select("id").eq("id", convA);
        expect(conv.data ?? [], label).toEqual([]);
        const msgs = await client.from("messages").select("id").eq("conversation_id", convA);
        expect(msgs.data ?? [], label).toEqual([]);
      }
    });

    it("RPC выборки по подставленному id чужого диалога — пусто; в список чужие не попадают", async () => {
      for (const client of [managerB, outsider]) {
        const page = await client.rpc("get_messages_page", { p_conversation_id: convA, p_before_created_at: nul, p_before_id: nul, p_limit: 10 });
        expect(page.data ?? []).toEqual([]);
        const list = await client.rpc("list_conversations_page", { p_before_at: nul, p_before_id: nul, p_limit: 50 });
        expect((list.data ?? []).map((r: { id: string }) => r.id)).not.toContain(convA);
      }
    });

    it("аноним не может вызвать RPC", async () => {
      const res = await anon.rpc("get_messages_page", { p_conversation_id: convA, p_before_created_at: nul, p_before_id: nul, p_limit: 10 });
      expect(res.error).not.toBeNull();
      expect((await anon.rpc("count_unread_conversations")).error).not.toBeNull();
    });

    it("свой менеджер видит диалог в списке", async () => {
      const list = await managerA.rpc("list_conversations_page", { p_before_at: nul, p_before_id: nul, p_limit: 50 });
      expect((list.data ?? []).map((r: { id: string }) => r.id)).toContain(convA);
    });
  });

  describe("запись клиентом запрещена (инвариант 4)", () => {
    it("менеджер не вставляет, не меняет и не удаляет сообщения; не меняет диалог", async () => {
      const insert = await managerA.from("messages").insert({ conversation_id: convA, direction: "out", text: "подделка" });
      expect(insert.error).not.toBeNull();

      await managerA.from("messages").update({ text: "правка" }).eq("conversation_id", convA);
      await managerA.from("messages").delete().eq("conversation_id", convA);
      await managerA.from("conversations").update({ manager_last_read_at: "2030-01-01T00:00:00+00:00", display_name: "взлом" }).eq("id", convA);
      await managerA.from("conversations").delete().eq("id", convA);

      const count = await service.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", convA);
      expect(count.count).toBe(14);
      expect((await service.from("messages").select("id").eq("conversation_id", convA).eq("text", "правка")).data).toEqual([]);
      const row = await conversationRow(convA);
      expect(row.display_name).not.toBe("взлом");
      expect(row.manager_last_read_at).toBeNull();
    });
  });

  describe("триггер, непрочитанные, отметка прочтения", () => {
    it("last_message_at = max(created_at); превью — последнее ТЕКСТОВОЕ; кнопка превью не подменяет", async () => {
      const row = await conversationRow(convA);
      expect(compareTimestamptz(row.last_message_at, "2026-01-01T10:02:00.123456+00:00")).toBe(0);
      // №11…№14 — группа с одной меткой: превью берётся по тому же арбитру (created_at, id), что и порядок страниц.
      const top = await managerA.rpc("get_messages_page", { p_conversation_id: convA, p_before_created_at: nul, p_before_id: nul, p_limit: 1 });
      expect(row.last_message_preview).toBe(top.data?.[0]?.text);
      expect(row.last_message_preview).toMatch(/^№1[1-4]$/);

      const conv = await conversation(restaurantA);
      await addMessages(conv, [
        { direction: "in", text: "привет", created_at: "2026-02-01T10:00:00+00:00" },
        { direction: "in", kind: "button", text: "[кнопка] menu:booking", created_at: "2026-02-01T10:01:00+00:00" },
      ]);
      const after = await conversationRow(conv);
      expect(after.last_message_preview).toBe("привет");
      expect(compareTimestamptz(after.last_message_at, "2026-02-01T10:01:00+00:00")).toBe(0);
    });

    it("сообщение, закоммиченное позже, но с меткой раньше, диалог назад не откатывает", async () => {
      const conv = await conversation(restaurantA);
      await addMessages(conv, [{ direction: "in", text: "позднее", created_at: "2026-02-02T10:00:05+00:00" }]);
      await addMessages(conv, [{ direction: "out", text: "раннее", created_at: "2026-02-02T10:00:01+00:00" }]);
      const row = await conversationRow(conv);
      expect(row.last_message_preview).toBe("позднее");
      expect(row.last_message_direction).toBe("in");
      expect(compareTimestamptz(row.last_message_at, "2026-02-02T10:00:05+00:00")).toBe(0);
    });

    it("unread_count: входящие текстовые после отметки; кнопки и ответы бота не считаются; отметка монотонна и обрезана по last_message_at", async () => {
      const conv = await conversation(restaurantA);
      await addMessages(conv, [
        { direction: "in", text: "1", created_at: "2026-03-01T10:00:01+00:00" },
        { direction: "out", text: "бот", created_at: "2026-03-01T10:00:02+00:00" },
        { direction: "in", kind: "button", text: "[кнопка] x", created_at: "2026-03-01T10:00:03+00:00" },
        { direction: "in", text: "2", created_at: "2026-03-01T10:00:04+00:00" },
        { direction: "in", text: "3", created_at: "2026-03-01T10:00:05+00:00" },
      ]);
      const unread = async () => {
        const list = await managerA.rpc("list_conversations_page", { p_before_at: nul, p_before_id: nul, p_limit: 100 });
        return list.data?.find((r: { id: string }) => r.id === conv)?.unread_count;
      };
      expect(await unread()).toBe(3);

      expect((await managerA.rpc("mark_conversation_read", { p_conversation_id: conv, p_up_to: "2026-03-01T10:00:04+00:00" })).error).toBeNull();
      expect(await unread()).toBe(1);

      // Запоздалый вызов с более ранней меткой отметку не откатывает.
      await managerA.rpc("mark_conversation_read", { p_conversation_id: conv, p_up_to: "2026-03-01T10:00:01+00:00" });
      expect(await unread()).toBe(1);

      // «Прочитать будущее» нельзя: метка из будущего обрезается по last_message_at.
      await managerA.rpc("mark_conversation_read", { p_conversation_id: conv, p_up_to: "2099-01-01T00:00:00+00:00" });
      const row = await conversationRow(conv);
      expect(compareTimestamptz(row.manager_last_read_at, row.last_message_at)).toBe(0);
      expect(await unread()).toBe(0);
    });

    it("потолок 100 и count_unread_conversations", async () => {
      const conv = await conversation(restaurantA);
      const rows: Seed[] = Array.from({ length: 105 }, (_, i) => ({
        direction: "in",
        text: `m${i}`,
        created_at: new Date(Date.UTC(2026, 3, 1, 10, 0, i)).toISOString().replace("Z", "+00:00"),
      }));
      await addMessages(conv, rows);
      const list = await managerA.rpc("list_conversations_page", { p_before_at: nul, p_before_id: nul, p_limit: 100 });
      expect(list.data?.find((r: { id: string }) => r.id === conv)?.unread_count).toBe(100);

      const before = (await managerA.rpc("count_unread_conversations")).data as number;
      expect(before).toBeGreaterThanOrEqual(1);
      await managerA.rpc("mark_conversation_read", { p_conversation_id: conv, p_up_to: "2026-04-01T11:00:00+00:00" });
      expect((await managerA.rpc("count_unread_conversations")).data).toBe(before - 1);
      // Менеджер другого ресторана свой счёт не получает за чужое.
      expect((await managerB.rpc("count_unread_conversations")).data).toBe(0);
    });

    it("отметка чужого диалога — ошибка not_found, отметка не меняется", async () => {
      const res = await managerB.rpc("mark_conversation_read", { p_conversation_id: convA, p_up_to: "2026-01-01T10:02:00+00:00" });
      expect(res.error?.message).toBe("not_found");
      expect((await anon.rpc("mark_conversation_read", { p_conversation_id: convA, p_up_to: "2026-01-01T10:02:00+00:00" })).error).not.toBeNull();
      expect((await conversationRow(convA)).manager_last_read_at).toBeNull();
      // Несуществующий диалог неотличим от чужого.
      const missing = await managerA.rpc("mark_conversation_read", { p_conversation_id: crypto.randomUUID(), p_up_to: "2026-01-01T10:02:00+00:00" });
      expect(missing.error?.message).toBe("not_found");
    });
  });

  describe("Realtime (инвариант 5, формат метки)", () => {
    it("свой менеджер получает INSERT сообщения и UPDATE диалога; чужой — нет; метка совпадает с RPC", async () => {
      const conv = await conversation(restaurantA);
      const listen = async (client: SupabaseClient, name: string) => {
        const events: Array<{ table: string; type: string; row: Record<string, unknown> }> = [];
        const channel = client
          .channel(`chat-probe-${name}-${runId}`)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conv}` }, (p) =>
            events.push({ table: "messages", type: p.eventType, row: p.new }),
          )
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, (p) =>
            events.push({ table: "conversations", type: p.eventType, row: p.new }),
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
        return events;
      };
      const mine = await listen(managerA, "a");
      const foreign = await listen(managerB, "b");

      // Дробь переменной длины: '.12' (хвостовые нули отбрасываются) — проверяем, что все источники согласны.
      const stamp = "2026-05-01T10:00:00.120000+00:00";
      await addMessages(conv, [{ direction: "in", text: "realtime", created_at: stamp }]);

      // Realtime после простоя отстаёт: в одном из прогонов первые события не пришли и за 20 с, в другом пришли
      // через 3 с (LOG S06). Ждём до 45 с, а не считаем отсутствие события потерей по короткому таймауту.
      const deadline = Date.now() + 45_000;
      while ((!mine.some((e) => e.table === "messages") || !mine.some((e) => e.table === "conversations" && e.row.id === conv)) && Date.now() < deadline) {
        await sleep(250);
      }
      await sleep(2_000);

      const insert = mine.find((e) => e.table === "messages");
      expect(insert?.type).toBe("INSERT");
      const rpc = await managerA.rpc("get_messages_page", { p_conversation_id: conv, p_before_created_at: nul, p_before_id: nul, p_limit: 5 });
      expect(rpc.data?.[0].created_at).toBe(insert?.row.created_at); // та же строка, без пересчёта
      expect(compareTimestamptz(insert?.row.created_at as string, stamp)).toBe(0);

      const update = mine.find((e) => e.table === "conversations" && e.row.id === conv);
      expect(update?.row.last_message_preview).toBe("realtime");
      expect(update?.row.last_message_direction).toBe("in");

      // Чужой менеджер: ни сообщений, ни обновления этого диалога (DELETE других тестов нас не касаются — подписаны на INSERT/UPDATE).
      expect(foreign.filter((e) => e.table === "messages")).toEqual([]);
      expect(foreign.filter((e) => e.table === "conversations" && e.row.id === conv)).toEqual([]);
    }, 90_000);
  });
});
