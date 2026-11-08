// Сценарные тесты S07: критерии готовности MVP (план §10) против настоящего роутера и dev-БД.
// Telegram подменён (testing/fakeTelegram.ts) — в настоящий Telegram ничего не уходит.
//
// Запуск (из supabase/functions):
//   deno test --allow-env --allow-net --allow-read --env-file=../../.env telegram-webhook/scenarios.integration.test.ts
// Без SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY пропускается.
//
// Данные блюд берутся из БД, а не из seed.sql: меню в dev правится из админки. Каждый тест — свой гость
// (лимит текста 3 за 30 с считается на гостя) и своя уборка в finally.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  BOOKING_SENT,
  CANCEL_DONE,
  DISH_NOT_FOUND,
  FLOW_CANCELLED,
  flowErrorText,
  GUEST_REQUEST_SENT,
  MENU_BOOKING,
  MENU_MAIN,
  MENU_MANAGER,
  MENU_MY,
  RATE_LIMIT_WARNING,
  SEARCH_CHOOSE,
  SEARCH_NOT_FOUND,
  SEARCH_TOO_MANY,
} from "../_shared/content.ts";
import { BUTTON_RATE_MAX } from "../_shared/domain/antispam.ts";
import { buildCallback } from "../_shared/domain/callbackData.ts";
import { ALLERGY_WARNING, UNAVAILABLE_LABEL } from "../_shared/domain/formatDishCard.ts";
import { formatPrice } from "../_shared/domain/formatPrice.ts";
import { NO_DATA } from "../_shared/domain/formatRestaurantInfo.ts";
import { continueFlow, getFlowState, submitFlow } from "../_shared/services/flow.ts";
import { createServiceClient } from "../_shared/supabaseClient.ts";
import type { ConversationRow } from "../_shared/types.ts";
import { createFakeTelegram, type FakeTelegram, telegramError } from "./testing/fakeTelegram.ts";
import { createTestGuest, type TestGuest } from "./testing/guest.ts";
import { findInternals, guestVisibleTexts } from "./testing/internals.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !enabled };

// ---------------------------------------------------------------- данные из БД

interface Dish {
  id: string;
  name: string;
  price: number;
  is_published: boolean;
  is_available: boolean;
  kcal_per_portion: number | null;
}

interface Fixtures {
  currency: string;
  managerChatId: number | null;
  published: Dish[];
  hidden: Dish[];
}

let cached: Fixtures | null = null;

async function fixtures(): Promise<Fixtures> {
  if (cached) return cached;
  const client = createServiceClient();
  // Бот работает с первым рестораном (getRestaurant) — берём его же.
  const { data: restaurant, error } = await client.from("restaurants").select("id, currency, manager_chat_id")
    .order("created_at").limit(1).single();
  if (error) throw error;
  const { data: dishes, error: dishError } = await client.from("menu_items")
    .select("id, name, price, is_published, is_available, kcal_per_portion")
    .eq("restaurant_id", restaurant.id);
  if (dishError) throw dishError;
  const all = (dishes ?? []) as Dish[];
  cached = {
    currency: restaurant.currency,
    managerChatId: restaurant.manager_chat_id,
    published: all.filter((d) => d.is_published),
    hidden: all.filter((d) => !d.is_published),
  };
  return cached;
}

/** Предусловие теста по данным dev-БД. Не выполнено — тест падает с понятной причиной, а не с загадочным assert. */
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`в dev-БД нет данных для теста: ${what} (перезалить seed: pnpm db:seed:remote)`);
  return value;
}

/** Опубликованное блюдо, которое поиск по его названию находит одно: ни одно другое название его не содержит. */
function uniquelyNamed(f: Fixtures, filter: (d: Dish) => boolean): Dish | undefined {
  return f.published.filter(filter).find((d) =>
    f.published.filter((o) => o.name.toLowerCase().includes(d.name.toLowerCase())).length === 1
  );
}

/** Слово, которое встречается в названиях хотя бы двух опубликованных блюд, — для запроса с несколькими совпадениями. */
function sharedWord(f: Fixtures): string | undefined {
  const words = new Set(f.published.flatMap((d) => d.name.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4)));
  return [...words].find((w) => f.published.filter((d) => d.name.toLowerCase().includes(w)).length >= 2);
}

// ---------------------------------------------------------------- обвязка

interface Scenario {
  client: ReturnType<typeof createServiceClient>;
  tg: FakeTelegram;
  guest: TestGuest;
  f: Fixtures;
}

/**
 * Гость + уборка + проверка критерия §10 №10 (внутренние данные) на всём, что гость увидел. Проверка в конце каждого
 * сценария: любой новый текст попадает под неё сам, без отдельного теста.
 */
async function scenario(fn: (s: Scenario) => Promise<void>, options: { username?: string } = {}): Promise<void> {
  const client = createServiceClient();
  const tg = createFakeTelegram();
  const guest = createTestGuest(client, tg, options);
  const f = await fixtures();
  try {
    await fn({ client, tg, guest, f });
    const problems = findInternals(guestVisibleTexts(tg, guest.id), {
      managerChatId: f.managerChatId,
      hiddenDishNames: f.hidden.map((d) => d.name),
    });
    assertEquals(problems, [], "§10.10: в ответах гостю внутренние данные");
  } finally {
    await guest.cleanup();
  }
}

const hasAction = (action: string) => (b: { callback_data: string }) => b.callback_data.startsWith("flow:") && b.callback_data.endsWith(`:${action}`);
const hasActionPrefix = (prefix: string) => (b: { callback_data: string }) => b.callback_data.startsWith("flow:") && b.callback_data.includes(`:${prefix}`);

/**
 * Проходит бронь до экрана «Проверьте заявку». Даты и часы берёт из кнопок, которые предложил бот, — тест не зависит
 * от дня недели и часа запуска (выходные, «сегодня не раньше +30 минут»).
 */
async function fillBooking(guest: TestGuest): Promise<void> {
  await guest.tap(MENU_BOOKING);
  for (let step = 0; step < 12; step++) {
    const { text, keyboard } = guest.screen();
    const buttons = keyboard.flat();
    if (text.startsWith("Проверьте заявку")) return;
    if (buttons.some(hasActionPrefix("d="))) await guest.tapWhere(hasActionPrefix("d="));
    else if (buttons.some(hasActionPrefix("p="))) await guest.tapWhere(hasActionPrefix("p="));
    else if (buttons.some(hasActionPrefix("h="))) await guest.tapWhere(hasActionPrefix("h="));
    else if (text.includes("Сколько будет гостей")) await guest.text("2");
    else if (text.includes("На чьё имя")) await guest.text("Тест Гость");
    else if (text.includes("телефон или @username")) await guest.text("+302310000000");
    else if (text.startsWith("Пожелания")) await guest.tapWhere(hasAction("skip"));
    else throw new Error(`неожиданный экран брони:\n${text}`);
  }
  throw new Error(`бронь не дошла до подтверждения:\n${guest.screen().text}`);
}

async function bookings(s: Scenario) {
  const { data, error } = await s.client.from("booking_requests").select("id, status, manager_notified_at")
    .eq("conversation_id", await s.guest.conversationId());
  if (error) throw error;
  return data ?? [];
}

async function guestRequests(s: Scenario) {
  const { data, error } = await s.client.from("guest_requests").select("id, kind, status, contact")
    .eq("conversation_id", await s.guest.conversationId());
  if (error) throw error;
  return data ?? [];
}

function managerMessages(s: Scenario): number {
  return s.tg.calls.filter((c) => c.method === "sendMessage" && c.chatId === s.f.managerChatId).length;
}

/** Сколько раз гость получил (отправкой или правкой) ровно этот текст. */
function timesShown(s: Scenario, text: string): number {
  return s.tg.calls.filter((c) => c.chatId === s.guest.id && c.text === text).length;
}

// ---------------------------------------------------------------- §10: меню

Deno.test({
  name: "§10.1 находит блюдо по названию и сообщает цену",
  ...opts,
  fn: () =>
    scenario(async ({ guest, f }) => {
      const dish = need(uniquelyNamed(f, (d) => d.is_available), "опубликованное доступное блюдо с уникальным названием");
      await guest.text(dish.name);
      const card = guest.screen().text;
      assertStringIncludes(card, `${dish.name} — ${formatPrice(dish.price, f.currency)}`);
      assert(!card.includes(UNAVAILABLE_LABEL), "доступное блюдо помечено недоступным");
    }),
});

Deno.test({
  name: "§10.2 уточняет выбор, если подходят несколько блюд",
  ...opts,
  fn: () =>
    scenario(async ({ guest, f }) => {
      const word = need(sharedWord(f), "слово в названиях двух опубликованных блюд");
      await guest.text(word);
      const list = guest.screen();
      assert([SEARCH_CHOOSE, SEARCH_TOO_MANY].includes(list.text), `ожидали уточнение, пришло: ${list.text}`);
      const dishButtons = list.keyboard.flat().filter((b) => b.callback_data.startsWith("dish:"));
      assert(dishButtons.length >= 2, "в уточнении меньше двух блюд");

      // Выбор из уточнения открывает карточку именно этого блюда.
      await guest.tap(dishButtons[0].callback_data, list.messageId);
      const name = dishButtons[0].text.split(" — ")[0];
      assertStringIncludes(guest.screen().text, name);
    }),
});

Deno.test({
  name: "§10.3 не выдумывает КБЖУ: «нет данных», не ноль; предупреждение про аллергию на карточке",
  ...opts,
  fn: () =>
    scenario(async ({ guest, f }) => {
      const dish = need(f.published.find((d) => d.kcal_per_portion === null), "опубликованное блюдо без КБЖУ");
      await guest.tap(buildCallback("dish", dish.id));
      const card = guest.screen().text;
      assertStringIncludes(card, `КБЖУ на порцию: ${NO_DATA}`);
      assert(!/\b0 ккал/.test(card), "отсутствующие калории показаны нулём");
      assertStringIncludes(card, ALLERGY_WARNING);
    }),
});

Deno.test({
  name: "§10.4 блюдо из стоп-листа помечено недоступным и в поиске, и в карточке",
  ...opts,
  fn: () =>
    scenario(async ({ guest, f }) => {
      const dish = need(f.published.find((d) => !d.is_available), "опубликованное блюдо в стоп-листе");
      await guest.tap(buildCallback("dish", dish.id));
      assertStringIncludes(guest.screen().text, UNAVAILABLE_LABEL);

      // В поиске: если блюдо нашлось одно — это карточка, если несколько — его кнопка с пометкой.
      await guest.text(dish.name);
      const found = guest.screen();
      const button = found.keyboard.flat().find((b) => b.callback_data === buildCallback("dish", dish.id));
      if (button) assertStringIncludes(button.text, "(недоступно)");
      else assertStringIncludes(found.text, UNAVAILABLE_LABEL);
    }),
});

Deno.test({
  name: "§10.4 неопубликованное блюдо не находится ни поиском, ни подделанной кнопкой",
  ...opts,
  fn: () =>
    scenario(async ({ guest, f }) => {
      const dish = need(f.hidden[0], "неопубликованное блюдо");
      await guest.tap(buildCallback("dish", dish.id));
      assertEquals(guest.screen().text, DISH_NOT_FOUND);

      await guest.text(dish.name);
      const found = guest.screen();
      const leaked = found.keyboard.flat().some((b) => b.callback_data === buildCallback("dish", dish.id));
      assert(!leaked, "неопубликованное блюдо в результатах поиска");
      // Проверка названия в тексте — общая, в scenario() (findInternals по hiddenDishNames).
      if (found.keyboard.flat().every((b) => !b.callback_data.startsWith("dish:"))) {
        assertEquals(found.text, SEARCH_NOT_FOUND);
      }
    }),
});

// ---------------------------------------------------------------- §10: бронь

Deno.test({
  name: "§10.5 + §10.6 бронь сохраняется только после «Отправить» и не называется подтверждённой",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      await fillBooking(s.guest);
      assertStringIncludes(s.guest.screen().text, "Это заявка, а не подтверждённая бронь");
      assertEquals((await bookings(s)).length, 0, "заявка создана до «Отправить»");

      await s.guest.tapWhere(hasAction("send"));
      const rows = await bookings(s);
      assertEquals(rows.length, 1);
      assertEquals(rows[0].status, "pending");
      assertEquals(s.guest.screen().text, BOOKING_SENT);
      assertEquals(managerMessages(s), s.f.managerChatId === null ? 0 : 1);

      // §10.6: до решения менеджера ни один текст гостю не утверждает, что бронь подтверждена.
      const claims = guestVisibleTexts(s.tg, s.guest.id).filter((t) => /бронь подтверждена/i.test(t));
      assertEquals(claims, []);
    }),
});

Deno.test({
  name: "§10.9 повторная доставка апдейта «Отправить» ничего не дублирует",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      await fillBooking(s.guest);
      const sendUpdate = await s.guest.tapWhere(hasAction("send"));
      const callsBefore = s.tg.calls.length;

      await s.guest.redeliver(sendUpdate);
      assertEquals(s.tg.calls.length, callsBefore, "повтор апдейта что-то отправил");
      assertEquals((await bookings(s)).length, 1);
    }),
});

Deno.test({
  name: "§10.9 два разных нажатия «Отправить» одновременно: одна заявка, одно уведомление, один итог",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      await fillBooking(s.guest);
      // Двойной тап: два апдейта с разными update_id по одной кнопке, обрабатываются параллельно.
      await Promise.all([s.guest.tapWhere(hasAction("send")), s.guest.tapWhere(hasAction("send"))]);

      // Подписи с хвостом переписки: гонка редкая, по одному «not equal» причину не восстановить.
      const tail = JSON.stringify(s.tg.calls.slice(-8).map((c) => [c.method, c.chatId === s.guest.id ? "guest" : c.chatId, c.text]));
      assertEquals((await bookings(s)).length, 1, `заявок не одна; вызовы: ${tail}`);
      assertEquals(managerMessages(s), s.f.managerChatId === null ? 0 : 1, `уведомлений менеджеру; вызовы: ${tail}`);
      assertEquals(timesShown(s, BOOKING_SENT), 1, `итог гостю; вызовы: ${tail}`);
    }),
});

Deno.test({
  name: "§10.9 двойной тап, отставший обработчик: не воскрешает отправленный черновик и не отвечает второй раз",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      // Детерминированная версия гонки выше. Обработчик B прочитал диалог ДО того, как A отправил заявку, а дошёл
      // до continueFlow/submitFlow ПОСЛЕ. Окно в живом прогоне узкое, поэтому порядок задаём руками.
      await fillBooking(s.guest);
      const conversationId = await s.guest.conversationId();
      const { data: before } = await s.client.from("conversations").select("*").eq("id", conversationId).single();
      const staleState = getFlowState(before as ConversationRow);
      if (!staleState) throw new Error("перед «Отправить» нет живого черновика");

      await s.guest.tapWhere(hasAction("send")); // A: заявка создана, черновик закрыт, гость получил итог

      // B: тот же черновик из устаревшего контекста.
      const advanced = await continueFlow(s.client, conversationId, staleState, { type: "action", action: "send" }, null);
      assertEquals(advanced.reply.screen.screen, "submit");
      const { data: between } = await s.client.from("conversations").select("state").eq("id", conversationId).single();
      assertEquals(between!.state, {}, "отставший обработчик записал отправленный черновик обратно");

      const result = await submitFlow(s.client, conversationId, advanced.state);
      assert(result.ok);
      assertEquals([result.created, result.claimed], [false, false], "отставший обработчик снова «выиграл» черновик");
      assertEquals((await bookings(s)).length, 1);
    }),
});

Deno.test({
  name: "бронь: сбой уведомления менеджера не теряет заявку",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      if (s.f.managerChatId === null) return; // уведомление выключено — проверять нечего
      await fillBooking(s.guest);
      s.tg.failNext("sendMessage", telegramError("sendMessage", 403, "Forbidden: bot was blocked by the user"), s.f.managerChatId);
      await s.guest.tapWhere(hasAction("send"));

      const [row] = await bookings(s);
      assertEquals(row.status, "pending");
      assertEquals(row.manager_notified_at, null);
      assertEquals(s.guest.screen().text, BOOKING_SENT);
    }),
});

Deno.test({
  name: "бронь: /cancel посреди сценария — заявки нет, состояние сброшено",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      await fillBooking(s.guest);
      await s.guest.text("/cancel");
      assertEquals(s.guest.screen().text, FLOW_CANCELLED);
      assertEquals((await bookings(s)).length, 0);

      const { data } = await s.client.from("conversations").select("state").eq("id", await s.guest.conversationId()).single();
      assertEquals(data!.state, {});
    }),
});

Deno.test({
  name: "«Мои заявки»: созданная бронь видна, отмена переводит её в cancelled и уведомляет менеджера",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      await fillBooking(s.guest);
      await s.guest.tapWhere(hasAction("send"));
      const [booking] = await bookings(s);

      await s.guest.tap(MENU_MY);
      await s.guest.tapWhere((b) => b.callback_data === `bk:${booking.id}`);
      await s.guest.tapWhere((b) => b.callback_data === `bk:${booking.id}:x`);
      await s.guest.tapWhere((b) => b.callback_data === `bk:${booking.id}:xy`);

      assertEquals(s.guest.screen().text, CANCEL_DONE);
      assertEquals((await bookings(s))[0].status, "cancelled");
      // Новая заявка + отмена.
      assertEquals(managerMessages(s), s.f.managerChatId === null ? 0 : 2);
    }),
});

// ---------------------------------------------------------------- §10: обращения

Deno.test({
  name: "§10.7 жалоба: без контакта, одна строка guest_requests со статусом new",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      await s.guest.tap(MENU_MANAGER);
      await s.guest.tapWhere(hasAction("k=complaint"));
      await s.guest.text("Суп был холодный");
      await s.guest.tapWhere(hasAction("skip")); // контакт для жалобы необязателен
      assertStringIncludes(s.guest.screen().text, "Проверьте обращение");
      assertEquals((await guestRequests(s)).length, 0, "обращение создано до «Отправить»");

      await s.guest.tapWhere(hasAction("send"));
      const rows = await guestRequests(s);
      assertEquals(rows.map((r) => [r.kind, r.status, r.contact]), [["complaint", "new", null]]);
      assertEquals(s.guest.screen().text, GUEST_REQUEST_SENT);
      assertEquals(managerMessages(s), s.f.managerChatId === null ? 0 : 1);
    }),
});

Deno.test({
  name: "§10.7 запрос менеджеру: контакт обязателен, неверный не принимается",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      await s.guest.tap(MENU_MANAGER);
      await s.guest.tapWhere(hasAction("k=manager_request"));
      await s.guest.text("Можно ли прийти с собакой?");
      // Без контакта ответить нельзя — пропустить шаг нечем.
      assert(!s.guest.screen().keyboard.flat().some(hasAction("skip")), "у запроса менеджеру можно пропустить контакт");

      await s.guest.text("не скажу");
      assertStringIncludes(s.guest.screen().text, flowErrorText("contact_invalid"));
      await s.guest.text("+302310000000");
      await s.guest.tapWhere(hasAction("send"));

      const rows = await guestRequests(s);
      assertEquals(rows.map((r) => [r.kind, r.status]), [["manager_request", "new"]]);
      assert(rows[0].contact, "контакт не сохранён");
    }),
});

// ---------------------------------------------------------------- hardening (S07)

Deno.test({
  name: "лимит кнопок: сверх BUTTON_RATE_MAX за окно — одна всплывашка, дальше тишина, в БД ничего",
  ...opts,
  fn: () =>
    scenario(async (s) => {
      for (let i = 0; i < BUTTON_RATE_MAX; i++) await s.guest.tap(MENU_MAIN);
      const conversationId = await s.guest.conversationId();
      const countButtons = async () => {
        const { count, error } = await s.client.from("messages").select("id", { count: "exact", head: true })
          .eq("conversation_id", conversationId).eq("kind", "button");
        if (error) throw error;
        return count;
      };
      assertEquals(await countButtons(), BUTTON_RATE_MAX);
      const callsBefore = s.tg.calls.length;

      await s.guest.tap(MENU_MAIN); // первое сверх лимита — предупреждение
      await s.guest.tap(MENU_MAIN); // дальше — молча
      const extra = s.tg.calls.slice(callsBefore);
      // Только ответы на нажатия (кнопка не «крутится»), ни одного сообщения в чат.
      assertEquals(extra.map((c) => [c.method, c.text]), [
        ["answerCallbackQuery", RATE_LIMIT_WARNING],
        ["answerCallbackQuery", null],
      ]);
      assertEquals(await countButtons(), BUTTON_RATE_MAX);
    }),
});
