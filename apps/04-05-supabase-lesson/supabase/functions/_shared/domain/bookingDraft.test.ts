import { assert, assertEquals } from "@std/assert";
import { advanceBooking, startBooking } from "./bookingFlow.ts";
import { applyBookingDraft, normalizeHour } from "./bookingDraft.ts";
import type { BookingState, FlowEnv } from "./flowState.ts";
import { startGuestRequest } from "./guestRequestFlow.ts";

// Часы как в bookingFlow.test.ts: вт–вс 13:00–24:00, понедельник — выходной.
const HOURS = Object.fromEntries(
  ["2", "3", "4", "5", "6", "7"].map((d) => [d, { open: "13:00", close: "24:00" }]),
);
// Вторник 2026-10-13, 15:00 в Афинах.
const env = (over: Partial<FlowEnv> = {}): FlowEnv => ({
  now: new Date("2026-10-13T12:00:00Z"),
  timeZone: "Europe/Athens",
  openingHours: HOURS,
  username: "anna_k",
  firstName: "Анна",
  newDraftId: () => "11111111-2222-3333-4444-555555555555",
  ...over,
});

Deno.test("normalizeHour: целые часы в формат кнопок, полчаса и мусор — нет", () => {
  assertEquals(normalizeHour("19"), "19:00");
  assertEquals(normalizeHour("7:00"), "07:00");
  assertEquals(normalizeHour(" 19:00 "), "19:00");
  assertEquals(normalizeHour("19:30"), null);
  assertEquals(normalizeHour("25"), null);
  assertEquals(normalizeHour("вечером"), null);
});

Deno.test("одна фраза: дата, время, гости → новый черновик, шаг «имя», не хватает имени и контакта", () => {
  const o = applyBookingDraft(null, { date: "2026-10-14", time: "19:00", guests: 4 }, env());
  const s = o.result.state as BookingState;
  assertEquals(s.flow, "booking");
  assertEquals(s.step, "name");
  assertEquals(s.data, { date: "2026-10-14", period: "dinner", time: "19:00", guests: 4 });
  assertEquals(o.accepted, ["date", "time", "guests"]);
  assertEquals(o.errors, {});
  assertEquals(o.missing, ["name", "contact"]);
  // Контакта нет: имя можно сразу с телефоном, кнопка «Использовать Telegram» — имя из профиля и @username.
  assertEquals(o.result.reply.screen, { screen: "ask_name", withContact: true, telegram: { name: "Анна", username: "anna_k" } });
});

Deno.test("всё обязательное есть → сразу сводка с «Что-нибудь ещё?», пожелание из фразы сохраняется", () => {
  const o = applyBookingDraft(
    null,
    { date: "2026-10-14", time: "19", guests: "2", name: "Анна", contact: "+30 690 123 4567", comment: "у окна" },
    env(),
  );
  const s = o.result.state as BookingState;
  assertEquals(s.step, "confirm");
  assertEquals(s.data.comment, "у окна");
  assert(o.result.reply.screen.screen === "confirm" && o.result.reply.screen.askMore === true);
  assertEquals(s.data.contact, "+306901234567");
  assertEquals(o.missing, []);
  assertEquals(o.result.reply.screen.screen, "confirm");
  // Дальше — обычный сценарий: «Отправить» даёт submit.
  assertEquals(advanceBooking(s, { type: "action", action: "send" }, env()).reply.screen, { screen: "submit" });
});

Deno.test("дополняет черновик, начатый кнопками, и сохраняет его draftId", () => {
  const started = startBooking(env()).state as BookingState;
  const onHour = advanceBooking(
    advanceBooking(started, { type: "action", action: "d=2026-10-20" }, env()).state as BookingState,
    { type: "action", action: "p=dinner" },
    env(),
  ).state as BookingState;
  assertEquals(onHour.step, "hour");

  const o = applyBookingDraft(onHour, { time: "20:00" }, env());
  const s = o.result.state as BookingState;
  assertEquals(s.draftId, started.draftId);
  assertEquals(s.step, "guests");
  assertEquals(s.data, { date: "2026-10-20", period: "dinner", time: "20:00" });
});

Deno.test("после черновика имя и телефон одним сообщением → сразу сводка", () => {
  const drafted = applyBookingDraft(null, { date: "2026-10-14", time: "19:00", guests: 4 }, env()).result.state as BookingState;
  const r = advanceBooking(drafted, { type: "text", text: "Анна, +30 690 123 4567" }, env());
  assertEquals(r.state.step, "confirm");
  assertEquals((r.state as BookingState).data.name, "Анна");
  assertEquals((r.state as BookingState).data.contact, "+306901234567");
});

Deno.test("агент дал контакт без имени → шаг имени без кнопки Telegram, затем сводка", () => {
  const o = applyBookingDraft(null, { date: "2026-10-14", time: "19:00", guests: 4, contact: "@petr_k" }, env());
  assertEquals(o.result.reply.screen, { screen: "ask_name", withContact: false, telegram: null });
  const r = advanceBooking(o.result.state as BookingState, { type: "text", text: "Пётр" }, env());
  assertEquals(r.state.step, "confirm");
});

Deno.test("ошибки полей: принятое пишется, непринятое — в errors со свободными часами", () => {
  // 14:00 сегодня уже прошло (сейчас 15:00), гостей 30 — больше предела.
  const o = applyBookingDraft(null, { date: "2026-10-13", time: "14:00", guests: 30, name: "Анна" }, env());
  const s = o.result.state as BookingState;
  assertEquals(o.errors, { time: "too_soon", guests: "guests_too_many" });
  assertEquals(s.data, { date: "2026-10-13", name: "Анна" });
  assertEquals(s.step, "period");
  assert(o.freeHours?.[0] === "16:00", `первый свободный час сегодня — 16:00 (15:00 + 30 мин), а не ${o.freeHours?.[0]}`);
});

Deno.test("время без даты не принимается: needs_date", () => {
  const o = applyBookingDraft(null, { time: "19:00", guests: 4 }, env());
  assertEquals(o.errors, { time: "needs_date" });
  assertEquals(o.result.state.step, "date");
  assertEquals(o.missing, ["date", "time", "name", "contact"]);
});

Deno.test("дата: выходной, прошлое, полчаса", () => {
  assertEquals(applyBookingDraft(null, { date: "2026-10-19" }, env()).errors, { date: "closed" }); // понедельник
  assertEquals(applyBookingDraft(null, { date: "2026-10-12" }, env()).errors, { date: "date_in_past" });
  assertEquals(applyBookingDraft(null, { date: "2026-10-14", time: "19:30" }, env()).errors, { time: "bad_time" });
});

Deno.test("смена даты: прежнее время остаётся, если подходит, иначе сбрасывается", () => {
  const first = applyBookingDraft(null, { date: "2026-10-14", time: "19:00" }, env()).result.state;
  const moved = applyBookingDraft(first, { date: "2026-10-15" }, env()).result.state as BookingState;
  assertEquals(moved.data.time, "19:00");
  // Сегодня в 15:00 нельзя: время сбрасывается, шаг возвращается к периоду.
  const early = applyBookingDraft(null, { date: "2026-10-14", time: "15:00" }, env()).result.state;
  const today = applyBookingDraft(early, { date: "2026-10-13" }, env()).result.state as BookingState;
  assertEquals(today.data.time, undefined);
  assertEquals(today.step, "period");
});

Deno.test("изменение брони: имя и контакт не меняются, после гостей — сводка", () => {
  const change = { replacesId: "b-1", guests: 2, name: "Анна", contact: "@anna_k", comment: null };
  const started = startBooking(env(), change).state;
  const o = applyBookingDraft(started, { date: "2026-10-14", time: "19:00", guests: 3, name: "Пётр" }, env());
  const s = o.result.state as BookingState;
  assertEquals(o.errors, { name: "not_editable" });
  assertEquals(s.data.name, "Анна");
  assertEquals(s.step, "confirm");
  assertEquals(o.missing, []);
});

Deno.test("живое обращение заменяется новой бронью", () => {
  const request = startGuestRequest(env()).state;
  const s = applyBookingDraft(request, { guests: 2 }, env()).result.state;
  assertEquals(s.flow, "booking");
  assertEquals(s.step, "date");
});

Deno.test("контакт «по Телеграму» (useTelegram) → @username гостя, а не шаблон от модели", () => {
  const o = applyBookingDraft(null, { date: "2026-10-14", time: "19:00", guests: 4, name: "Анна", contact: "@username", useTelegram: true }, env());
  assertEquals((o.result.state as BookingState).data.contact, "@anna_k");
  assertEquals((o.result.state as BookingState).step, "confirm");
  assertEquals(o.errors, {});
});

Deno.test("шаблонный контакт без useTelegram не пишется: ошибка модели, шаг контакта", () => {
  const o = applyBookingDraft(null, { date: "2026-10-14", time: "19:00", guests: 4, name: "Анна", contact: "@username" }, env());
  assertEquals(o.errors, { contact: "contact_placeholder" });
  assertEquals((o.result.state as BookingState).data.contact, undefined);
  assertEquals(o.missing, ["contact"]);
});

Deno.test("useTelegram при изменении брони — not_editable, как любой контакт", () => {
  const started = startBooking(env(), { replacesId: "b-1", guests: 2, name: "Анна", contact: "+306901234567", comment: null }).state;
  const o = applyBookingDraft(started, { useTelegram: true }, env());
  assertEquals(o.errors, { contact: "not_editable" });
});

Deno.test("поправка агенту на карточке: «нас четверо» → гостей 4 ✏️, снова карточка; пожелание дописывается", () => {
  const card = applyBookingDraft(null, { date: "2026-10-14", time: "19:00", guests: 3, name: "Анна", contact: "+306901234567" }, env());
  assertEquals((card.result.state as BookingState).step, "confirm");

  const fixed = applyBookingDraft(card.result.state, { guests: 4 }, env());
  assertEquals((fixed.result.state as BookingState).step, "confirm");
  const screen = fixed.result.reply.screen;
  assert(screen.screen === "confirm" && screen.summary.includes("👥 Гостей: 4 ✏️"));
  assert(screen.screen === "confirm" && !screen.summary.includes("Дата: ср, 14.10.2026 ✏️"));

  const wish = applyBookingDraft(fixed.result.state, { comment: "у окна" }, env());
  const s2 = wish.result.reply.screen;
  assert(s2.screen === "confirm" && s2.summary.includes("💬 Пожелания: у окна ✏️") && !s2.summary.includes("Гостей: 4 ✏️"));
});

Deno.test("черновик вне карточки (первая фраза) — без пометок ✏️", () => {
  const card = applyBookingDraft(null, { date: "2026-10-14", time: "19:00", guests: 3, name: "Анна", contact: "+306901234567" }, env());
  const screen = card.result.reply.screen;
  assert(screen.screen === "confirm" && !screen.summary.includes("✏️"));
});
