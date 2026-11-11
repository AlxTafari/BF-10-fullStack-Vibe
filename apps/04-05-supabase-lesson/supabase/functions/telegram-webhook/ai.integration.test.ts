// Сценарии AI-маршрута (S09, сессии 2–3): настоящий роутер, БД с seed, фейковые Telegram и LLM.
// Запуск (из supabase/functions):
//   deno test --allow-env --allow-net --allow-read --env-file=../../.env telegram-webhook/ai.integration.test.ts
// Без SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY пропускается.
import { assert, assertEquals } from "@std/assert";
import { AI_FALLBACK, aiWelcomeText, MAIN_MENU_KEYBOARD, MENU_BOOKING, MENU_MAIN } from "../_shared/content.ts";
import { availableDates } from "../_shared/domain/bookingRules.ts";
import { freeHoursOn } from "../_shared/domain/bookingDraft.ts";
import { buildCallback } from "../_shared/domain/callbackData.ts";
import { answer, call, createFakeLlm, type FakeLlm, type FakeLlmStep } from "../_shared/llm/fakeLlm.ts";
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

const hasAction = (action: string) => (b: { callback_data: string }) => b.callback_data.startsWith("flow:") && b.callback_data.endsWith(`:${action}`);
const hasActionPrefix = (prefix: string) => (b: { callback_data: string }) => b.callback_data.startsWith("flow:") && b.callback_data.includes(`:${prefix}`);
const buttonsOf = (s: AiScenario) => s.guest.screen().keyboard.flat();

/** Первый слот, на который сейчас можно забронировать (по часам работы seed): тест не зависит от дня запуска. */
async function bookableSlot(client: ReturnType<typeof createServiceClient>): Promise<{ date: string; time: string }> {
  // Бот работает с первым рестораном; обработчикам (и их тестам) репозитории недоступны — читаем запросом.
  const { data: r, error } = await client.from("restaurants").select("timezone, opening_hours")
    .order("created_at").limit(1).single();
  if (error) throw error;
  const env = { now: new Date(), timeZone: r.timezone as string, openingHours: r.opening_hours };
  for (const date of availableDates(env)) {
    const hours = freeHoursOn(date, env);
    if (hours.length > 0) return { date, time: hours[0] };
  }
  throw new Error("нет свободных слотов в ближайшие дни");
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
      answer("Есть дорада на гриле, 24 €.", [{ kind: "dish", dishId: dorada!.id }, { kind: "booking" }]),
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
        { ai: true, model: "fake-model", tools: ["searchMenu"], calls: 2 },
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
  name: "AI: подошедший шагу текст забирает сценарий, агент не вызывается",
  fn: () =>
    aiScenario([], async (s) => {
      await s.guest.tap(MENU_BOOKING);
      await s.guest.tapWhere(hasActionPrefix("d="));
      await s.guest.tapWhere(hasActionPrefix("p="));
      await s.guest.tapWhere(hasActionPrefix("h="));
      await s.guest.text("4");
      assertEquals(s.llm.requests.length, 0);
      assert(s.guest.screen().text.includes("На чьё имя"), "следующий шаг — имя");
    }),
});

Deno.test({
  ...opts,
  name: "AI (сессия 3): бронь одной фразой → недостающее шагами → карточка → заявка, как от кнопок",
  fn: async () => {
    const client = createServiceClient();
    const slot = await bookableSlot(client);
    await aiScenario([
      call("draftBooking", { date: slot.date, time: slot.time, guests: 4 }),
      answer("Отлично! На чьё имя оформить и как с вами связаться?"),
    ], async (s) => {
      await s.guest.text("стол на четверых");
      // Ответ агента, под ним — кнопки шага «имя» (Назад / Отмена), а не suggestions.
      assertEquals(s.guest.screen().text, "Отлично! На чьё имя оформить и как с вами связаться?");
      assert(buttonsOf(s).some(hasAction("cancel")), "под ответом кнопки шага");
      const { data: before } = await client.from("booking_requests").select("id").eq("conversation_id", await s.guest.conversationId());
      assertEquals(before, [], "черновик заявку не создаёт");

      // Имя и телефон одним сообщением — обычный шаг, без модели; дальше карточка с «Что-нибудь ещё?».
      await s.guest.text("Анна +302310000000");
      assert(s.guest.screen().text.startsWith("Проверьте заявку"), s.guest.screen().text);
      assert(s.guest.screen().text.includes("Что-нибудь ещё?"));
      // Ответ текстом на карточке — пожелание, карточка рисуется заново.
      await s.guest.text("у окна");
      assert(s.guest.screen().text.includes("Пожелания: у окна"), s.guest.screen().text);
      await s.guest.tapWhere(hasAction("send"));

      const { data: rows } = await client.from("booking_requests").select("guests_count, guest_name, contact, comment")
        .eq("conversation_id", await s.guest.conversationId());
      assertEquals(rows, [{ guests_count: 4, guest_name: "Анна", contact: "+302310000000", comment: "у окна" }]);
      // BUG-002: вопросы бота остаются в истории, кнопки есть только у последнего сообщения.
      const history = s.guest.messages();
      assert(history.some((m) => m.text === "Отлично! На чьё имя оформить и как с вами связаться?"), "вопрос агента не удалён");
      assertEquals(history.slice(0, -1).filter((m) => m.keyboard.flat().some((b) => b.callback_data.startsWith("flow:"))), []);
      assertEquals(s.llm.remaining(), 0);
      // Ответ агента посчитан в лимит и журнал, как любой AI-ответ.
      const ai = (await journal(s)).filter((r) => (r.meta as { ai?: boolean } | null)?.ai);
      assertEquals(ai.length, 1);
    });
  },
});

Deno.test({
  ...opts,
  name: "AI (сессия 3): всё в одной фразе → карточка сразу под ответом агента",
  fn: async () => {
    const client = createServiceClient();
    const slot = await bookableSlot(client);
    await aiScenario([
      call("draftBooking", { date: slot.date, time: slot.time, guests: 2, name: "Анна", contact: "@anna_test" }),
      answer("Проверьте, пожалуйста, заявку ниже."),
    ], async (s) => {
      await s.guest.text("бронь на двоих, Анна, @anna_test");
      const texts = s.guest.messages().map((m) => m.text);
      assert(texts.includes("Проверьте, пожалуйста, заявку ниже."));
      assert(s.guest.screen().text.startsWith("Проверьте заявку"), "карточка — последним сообщением");
      assert(buttonsOf(s).some(hasAction("send")));
    });
  },
});

Deno.test({
  ...opts,
  name: "AI (сессия 3): побочный вопрос на шаге «время» → ответ и кнопки шага, затем время текстом",
  fn: async () => {
    let hour = "";
    await aiScenario([
      answer("Да, детские стулья есть. На какое время вас записать?"),
      (request) => {
        // Агенту передан контекст шага: живой черновик и что спрашивает шаг.
        assert(request.system.includes("# Active draft"));
        assert(request.system.includes("asks for the time"));
        return call("draftBooking", { time: hour });
      },
      answer("Записал. Сколько будет гостей?"),
    ], async (s) => {
      await s.guest.tap(MENU_BOOKING);
      await s.guest.tapWhere(hasActionPrefix("d="));
      await s.guest.tapWhere(hasActionPrefix("p="));
      // Час для «давай в …» — последний из предложенных ботом кнопками.
      const hourButtons = buttonsOf(s).filter(hasActionPrefix("h="));
      hour = hourButtons.at(-1)!.text;

      await s.guest.text("а у вас есть детские стулья?");
      assertEquals(s.guest.screen().text, "Да, детские стулья есть. На какое время вас записать?");
      assertEquals(buttonsOf(s).filter(hasActionPrefix("h=")).length, hourButtons.length, "кнопки часа на месте");

      await s.guest.text(`давай в ${hour}`);
      assertEquals(s.guest.screen().text, "Записал. Сколько будет гостей?");
      // Дальше — обычный шаг: число гостей без модели.
      await s.guest.text("3");
      assert(s.guest.screen().text.includes("На чьё имя"));
      assertEquals(s.llm.remaining(), 0);
    });
  },
});

Deno.test({
  ...opts,
  name: "AI (сессия 3): агент сломался на шаге → экран шага с ошибкой, как до S09",
  fn: () =>
    aiScenario([{ error: "quota" }], async (s) => {
      await s.guest.tap(MENU_BOOKING);
      await s.guest.text("завтра");
      assert(s.guest.screen().text.includes("Выберите вариант кнопкой"));
      assert(buttonsOf(s).some(hasActionPrefix("d=")));
      const rows = await journal(s);
      assertEquals(rows.at(-1)?.meta, { aiFallback: "quota" });
    }),
});

Deno.test({
  ...opts,
  name: "AI (сессия 3): выключен → неподошедший текст на шаге даёт ошибку шага, модель не вызывается",
  fn: async () => {
    const client = createServiceClient();
    const before = await setAiEnabled(client, false);
    try {
      await aiScenario([], async (s) => {
        await s.guest.tap(MENU_BOOKING);
        await s.guest.text("завтра");
        assertEquals(s.llm.requests.length, 0);
        assert(s.guest.screen().text.includes("Выберите вариант кнопкой"));
      });
    } finally {
      await setAiEnabled(client, before);
    }
  },
});

Deno.test({
  ...opts,
  name: "AI (сессия 3): «позовите менеджера, не понравилось обслуживание» → черновик → «Отправить» → обращение",
  fn: () =>
    aiScenario([
      call("draftGuestRequest", { kind: "complaint", text: "Не понравилось обслуживание" }),
      answer("Сожалею. Передам менеджеру — оставите контакт для ответа?"),
    ], async (s) => {
      await s.guest.text("позовите менеджера, мне не понравилось обслуживание");
      assertEquals(s.guest.screen().text, "Сожалею. Передам менеджеру — оставите контакт для ответа?");
      // Контакт для жалобы необязателен: кнопка «Пропустить» шага.
      await s.guest.tapWhere(hasAction("skip"));
      assert(s.guest.screen().text.startsWith("Проверьте обращение"));
      await s.guest.tapWhere(hasAction("send"));

      const { data } = await s.client.from("guest_requests").select("kind, text, contact")
        .eq("conversation_id", await s.guest.conversationId());
      assertEquals(data, [{ kind: "complaint", text: "Не понравилось обслуживание", contact: null }]);
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

// ---------------------------------------------------------------- менеджер в диалоге (S06b)

/** Ручной режим диалога гостя: метку ставим напрямую (в жизни — RPC менеджера через manager-chat). */
async function setHandoff(s: AiScenario, until: Date | null): Promise<void> {
  const { error } = await s.client.from("conversations")
    .update({ handoff_until: until?.toISOString() ?? null })
    .eq("id", await s.guest.conversationId());
  if (error) throw error;
}

Deno.test({
  ...opts,
  name: "S06b: менеджер в диалоге — текст гостя записан, бот молчит, модель не вызывается; кнопки работают",
  fn: () =>
    aiScenario([], async (s) => {
      await s.guest.text("/start");
      await setHandoff(s, new Date(Date.now() + 30 * 60_000));
      const sentBefore = s.tg.calls.filter((c) => c.method === "sendMessage").length;

      await s.guest.text("хочу стол у окна, можно?");
      assertEquals(s.tg.calls.filter((c) => c.method === "sendMessage").length, sentBefore, "бот не отвечает");
      assertEquals(s.llm.requests.length, 0, "агент не вызывается");
      const last = (await journal(s)).at(-1)!;
      assertEquals([last.direction, last.kind, last.text], ["in", "text", "хочу стол у окна, можно?"]);

      // Кнопки — навигация, а не разговор: работают и в ручном режиме.
      await s.guest.tap(MENU_MAIN);
      assertEquals(s.guest.screen().keyboard, MAIN_MENU_KEYBOARD);
    }),
});

Deno.test({
  ...opts,
  name: "S06b: истёкший ручной режим — снова отвечает агент, реплика менеджера в истории с префиксом",
  fn: () =>
    aiScenario([answer("Столик у окна уточнит менеджер.", [])], async (s) => {
      await s.guest.text("/start");
      const { error } = await s.client.from("messages").insert({
        conversation_id: await s.guest.conversationId(),
        direction: "out",
        kind: "text",
        text: "Посажу вас у окна",
        meta: { manager: true, managerId: crypto.randomUUID() },
      });
      if (error) throw error;
      await setHandoff(s, new Date(Date.now() - 60_000));

      await s.guest.text("а во сколько можно прийти?");
      assertEquals(s.guest.screen().text, "Столик у окна уточнит менеджер.");
      const history = s.llm.requests[0].messages;
      assert(
        history.some((m) => m.role === "model" && m.text?.includes("[Restaurant manager]: Посажу вас у окна")),
        "реплика менеджера помечена для модели",
      );
    }),
});
