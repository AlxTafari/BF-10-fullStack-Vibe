// Сценарии AI-маршрута (S09, сессия 2): настоящий роутер, БД с seed, фейковые Telegram и LLM.
// Запуск (из supabase/functions):
//   deno test --allow-env --allow-net --allow-read --env-file=../../.env telegram-webhook/ai.integration.test.ts
// Без SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY пропускается.
import { assert, assertEquals } from "@std/assert";
import { AI_FALLBACK, aiWelcomeText, MAIN_MENU_KEYBOARD, MENU_BOOKING, MENU_MAIN } from "../_shared/content.ts";
import { buildCallback } from "../_shared/domain/callbackData.ts";
import { call, createFakeLlm, type FakeLlm, type FakeLlmStep, say } from "../_shared/llm/fakeLlm.ts";
import { getRestaurantInfo } from "../_shared/services/restaurantInfo.ts";
import { createServiceClient } from "../_shared/supabaseClient.ts";
import { createFakeTelegram, type FakeTelegram } from "./testing/fakeTelegram.ts";
import { createTestGuest, type TestGuest } from "./testing/guest.ts";
import { findInternals, guestVisibleTexts } from "./testing/internals.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !enabled };

interface AiScenario {
  client: ReturnType<typeof createServiceClient>;
  tg: FakeTelegram;
  llm: FakeLlm;
  guest: TestGuest;
}

/** Гость с фейковой моделью; в конце — проверка внутренних данных на всём, что гость увидел, и уборка. */
async function aiScenario(steps: FakeLlmStep[], fn: (s: AiScenario) => Promise<void>): Promise<void> {
  const client = createServiceClient();
  const tg = createFakeTelegram();
  const llm = createFakeLlm(steps);
  const guest = createTestGuest(client, tg, { llm });
  try {
    await fn({ client, tg, llm, guest });
    const { data } = await client.from("menu_items").select("name").eq("is_published", false);
    const problems = findInternals(guestVisibleTexts(tg, guest.id), {
      managerChatId: null,
      hiddenDishNames: (data ?? []).map((d) => d.name as string),
    });
    assertEquals(problems, [], "в ответах гостю внутренние данные");
  } finally {
    await guest.cleanup();
  }
}

/** Сообщения диалога гостя из БД по порядку: что записалось в журнал и с какой пометкой. */
async function journal(s: AiScenario) {
  const { data, error } = await s.client.from("messages")
    .select("direction, text, kind, meta")
    .eq("conversation_id", await s.guest.conversationId())
    .order("created_at").order("id");
  if (error) throw error;
  return data ?? [];
}

/** ai_enabled ресторана на время теста; возвращается к прежнему значению в finally вызывающего. */
async function setAiEnabled(client: ReturnType<typeof createServiceClient>, value: boolean): Promise<boolean> {
  // Бот работает с первым рестораном — его настройки и меняем.
  const { data: restaurant, error: restaurantError } = await client.from("restaurants").select("id")
    .order("created_at").limit(1).single();
  if (restaurantError) throw restaurantError;
  const { data: before } = await client.from("restaurant_ai_settings").select("ai_enabled")
    .eq("restaurant_id", restaurant.id).single();
  const { error } = await client.from("restaurant_ai_settings").update({ ai_enabled: value }).eq("restaurant_id", restaurant.id);
  if (error) throw error;
  return before?.ai_enabled ?? true;
}

Deno.test({
  ...opts,
  name: "AI: /start представляет AI-помощника, кнопки главного меню на месте",
  fn: () =>
    aiScenario([], async ({ client, guest, llm }) => {
      await guest.text("/start");
      const info = await getRestaurantInfo(client);
      assertEquals(guest.screen().text, aiWelcomeText(info!.name));
      assertEquals(guest.screen().keyboard, MAIN_MENU_KEYBOARD);
      assertEquals(llm.requests.length, 0, "приветствие без вызова модели");
    }),
});

Deno.test({
  ...opts,
  name: "AI: свободный текст → ответ агента, кнопки по смыслу, «печатает…», пометка в журнале",
  fn: async () => {
    const client = createServiceClient();
    const { data: dorada } = await client.from("menu_items").select("id").eq("name", "Дорада на гриле").single();
    await aiScenario([
      call("searchMenu", { query: "дорада" }),
      call("suggestActions", { actions: [{ kind: "dish", dishId: dorada!.id }, { kind: "booking" }] }),
      say("Есть дорада на гриле, 24 €."),
    ], async (s) => {
      await s.guest.text("че по рыбе?");

      assertEquals(s.guest.screen().text, "Есть дорада на гриле, 24 €.");
      assertEquals(s.guest.screen().keyboard, [
        [{ text: "🍽 Дорада на гриле", callback_data: buildCallback("dish", dorada!.id) }],
        [{ text: "📅 Забронировать стол", callback_data: MENU_BOOKING }],
        [{ text: "🏠 Главное меню", callback_data: MENU_MAIN }],
      ]);
      // «Печатает…» уходит до ответа.
      const methods = s.tg.calls.map((c) => c.method);
      assert(methods.indexOf("sendChatAction") < methods.lastIndexOf("sendMessage"));

      const rows = await journal(s);
      assertEquals(rows.map((r) => [r.direction, r.kind]), [["in", "text"], ["out", "text"]]);
      const meta = rows[1].meta as Record<string, unknown>;
      assertEquals(
        { ai: meta.ai, model: meta.model, tools: meta.tools, calls: meta.calls },
        { ai: true, model: "fake-model", tools: ["searchMenu", "suggestActions"], calls: 3 },
      );
      // Расход пишется всегда (у фейка токенов нет — нули), по нему считается статистика.
      assertEquals([meta.inputTokens, meta.outputTokens, meta.thoughtTokens], [0, 0, 0]);
      assert(typeof meta.ms === "number");
      assertEquals(s.llm.remaining(), 0);
    });
  },
});

Deno.test({
  ...opts,
  name: "AI: сбой модели → запасной ответ и главное меню, причина только в журнале",
  fn: () =>
    aiScenario([{ error: "quota" }], async (s) => {
      await s.guest.text("что посоветуете?");
      assertEquals(s.guest.screen().text, AI_FALLBACK);
      assertEquals(s.guest.screen().keyboard, MAIN_MENU_KEYBOARD);
      const rows = await journal(s);
      assertEquals(rows[1].meta, { aiFallback: "quota" });
    }),
});

Deno.test({
  ...opts,
  name: "AI: выключен у ресторана → свободный текст как до S09 (поиск), модель не вызывается",
  fn: async () => {
    const client = createServiceClient();
    const before = await setAiEnabled(client, false);
    try {
      await aiScenario([], async (s) => {
        await s.guest.text("дорада");
        assertEquals(s.llm.requests.length, 0);
        // Поиск нашёл одно блюдо — показал карточку.
        assert(s.guest.screen().text.includes("Дорада на гриле"));
        const rows = await journal(s);
        assertEquals(rows[0].kind, "search");
        assertEquals(rows[1].meta, null);
      });
    } finally {
      await setAiEnabled(client, before);
    }
  },
});

Deno.test({
  ...opts,
  name: "AI: шаг сценария забирает текст себе, агент не вызывается",
  fn: () =>
    aiScenario([], async (s) => {
      await s.guest.tap(MENU_BOOKING);
      await s.guest.text("завтра");
      assertEquals(s.llm.requests.length, 0);
      // Бот остался в сценарии брони: ответ — от шага, а не запасной ответ агента.
      assert(s.guest.screen().text !== AI_FALLBACK);
    }),
});

Deno.test({
  ...opts,
  name: "AI: кнопки работают и при включённом AI — нажатие не идёт к модели",
  fn: () =>
    aiScenario([], async (s) => {
      await s.guest.tap(MENU_MAIN);
      assertEquals(s.guest.screen().keyboard, MAIN_MENU_KEYBOARD);
      assertEquals(s.llm.requests.length, 0);
    }),
});
