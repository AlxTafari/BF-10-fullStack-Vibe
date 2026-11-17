import { assert, assertEquals } from "@std/assert";
import { advanceBooking, startBooking } from "./bookingFlow.ts";
import type { AdvanceResult, BookingData, BookingState, FlowEnv, FlowInput } from "./flowState.ts";

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

const act = (action: string): FlowInput => ({ type: "action", action });
const text = (t: string): FlowInput => ({ type: "text", text: t });

function run(start: AdvanceResult, inputs: FlowInput[], e = env()): AdvanceResult {
  let cur = start;
  for (const i of inputs) cur = advanceBooking(cur.state as BookingState, i, e);
  return cur;
}

const toGuests: FlowInput[] = [act("d=2026-10-20"), act("p=dinner"), act("h=19")];

Deno.test("счастливый путь до сводки и подтверждения", () => {
  const r = run(startBooking(env()), [
    ...toGuests,
    text("4"),
    text("Анна"),
    act("me"),
  ]);
  assertEquals(r.state.step, "confirm");
  // Пожеланий нет — поля нет: отдельного шага комментария больше нет, его пишут на сводке.
  assertEquals((r.state as BookingState).data, {
    date: "2026-10-20",
    period: "dinner",
    time: "19:00",
    guests: 4,
    name: "Анна",
    contact: "@anna_k",
  });
  assert(r.reply.screen.screen === "confirm" && r.reply.screen.askMore === true);

  const sent = advanceBooking(r.state as BookingState, act("send"), env());
  assertEquals(sent.reply.screen, { screen: "submit" });
  assertEquals(sent.state.step, "confirm"); // состояние не сброшено: при сбое гость нажмёт ещё раз
});

Deno.test("текст на шагах с кнопками (дата, период, час) → подсказка нажать кнопку", () => {
  let r = startBooking(env());
  r = advanceBooking(r.state as BookingState, text("завтра"), env());
  assertEquals(r.reply.error, "use_buttons");
  assertEquals(r.state.step, "date");

  r = run(r, [act("d=2026-10-20"), act("p=dinner"), text("19:00")]);
  assertEquals(r.reply.error, "use_buttons");
  assertEquals(r.state.step, "hour");
});

Deno.test("дата вне списка (прошлая, выходной) недоступна", () => {
  const start = startBooking(env());
  for (const d of ["2026-10-12", "2026-10-19", "2027-01-01"]) {
    const r = advanceBooking(start.state as BookingState, act(`d=${d}`), env());
    assertEquals(r.reply.error, "unavailable");
    assertEquals(r.state.step, "date");
  }
});

Deno.test("мусор на шаге гостей: остаёмся на шаге с причиной", () => {
  const base = run(startBooking(env()), toGuests);
  for (const [input, error] of [["0", "guests_too_few"], ["abc", "guests_not_integer"], ["4.5", "guests_not_integer"]]) {
    const r = advanceBooking(base.state as BookingState, text(input), env());
    assertEquals(r.reply.error, error);
    assertEquals(r.state.step, "guests");
  }
});

Deno.test("больше 20 гостей → экран «к менеджеру», кнопка запускает обращение", () => {
  const base = run(startBooking(env()), toGuests);
  const r = advanceBooking(base.state as BookingState, text("100"), env());
  assertEquals(r.reply.screen, { screen: "too_many_guests" });
  assertEquals(r.state.step, "guests");

  const sw = advanceBooking(r.state as BookingState, act("to_manager"), env());
  assertEquals(sw.state.flow, "guest_request");
  assertEquals(sw.reply.screen.screen, "ask_text");
});

Deno.test("имя из одного символа и контакт «абв» отклоняются", () => {
  const atName = run(startBooking(env()), [...toGuests, text("4")]);
  assertEquals(advanceBooking(atName.state as BookingState, text("А"), env()).reply.error, "name_too_short");

  const atContact = advanceBooking(atName.state as BookingState, text("Анна"), env());
  const bad = advanceBooking(atContact.state as BookingState, text("абв"), env());
  assertEquals(bad.reply.error, "contact_invalid");
  assertEquals(bad.state.step, "contact");
});

Deno.test("кнопка @username без username в апдейте не работает", () => {
  const e = env({ username: null });
  const atContact = run(startBooking(e), [...toGuests, text("4"), text("Анна")], e);
  assertEquals(atContact.reply.screen, { screen: "ask_contact", canUseUsername: false, optional: false });
  assertEquals(advanceBooking(atContact.state as BookingState, act("me"), e).reply.error, "unavailable");
});

Deno.test("сегодня: час стал слишком близким, пока гость выбирал → откат на выбор часа/периода", () => {
  const e1 = env();
  // Сегодня в 15:00 выбираем ужин 17:00.
  let r = run(startBooking(e1), [act("d=2026-10-13"), act("p=dinner")], e1);
  assertEquals(r.state.step, "hour");
  // Гость вернулся в 22:45 (по Афинам): все часы ушли.
  const late = env({ now: new Date("2026-10-13T19:45:00Z") });
  r = advanceBooking(r.state as BookingState, act("h=19"), late);
  assertEquals(r.reply.error, "unavailable");
  assertEquals(r.state.step, "date");
  assertEquals((r.state as BookingState).data, {});
});

Deno.test("«Начать заново» → новая заявка с новым draftId", () => {
  let n = 0;
  const e = env({ newDraftId: () => `00000000-0000-0000-0000-00000000000${++n}` });
  const first = startBooking(e);
  const r = advanceBooking(first.state as BookingState, act("restart"), e);
  assert(r.state.draftId !== first.state.draftId);
  assertEquals(r.state.step, "date");
});

Deno.test("битое состояние (шаг без данных) → сценарий начинается заново", () => {
  const broken: BookingState = {
    flow: "booking",
    step: "confirm",
    draftId: "11111111-2222-3333-4444-555555555555",
    data: { date: "2026-10-20" },
    touchedAt: env().now.toISOString(),
  };
  const r = advanceBooking(broken, act("send"), env());
  assertEquals(r.state.step, "date");
  assertEquals(r.reply.screen.screen, "ask_date");
});

Deno.test("каждый шаг обновляет touchedAt", () => {
  const later = env({ now: new Date("2026-10-13T12:10:00Z") });
  const r = advanceBooking(startBooking(env()).state as BookingState, act("d=2026-10-20"), later);
  assertEquals(r.state.touchedAt, "2026-10-13T12:10:00.000Z");
});

Deno.test("«Назад»: с часов обратно к периодам, выбранный период стирается, дата остаётся", () => {
  const atHour = run(startBooking(env()), [act("d=2026-10-20"), act("p=lunch")]);
  assertEquals(atHour.state.step, "hour");

  const back = advanceBooking(atHour.state as BookingState, act("back"), env());
  assertEquals(back.state.step, "period");
  assertEquals((back.state as BookingState).data, { date: "2026-10-20" });
  assertEquals(back.reply.screen.screen, "ask_period");

  // Можно выбрать другой период и увидеть его часы.
  const dinner = advanceBooking(back.state as BookingState, act("p=dinner"), env());
  assertEquals(dinner.reply.screen, { screen: "ask_hour", date: "2026-10-20", period: "dinner", hours: [17, 18, 19, 20, 21, 22] });
});

Deno.test("«Назад» со сводки — к контакту, пожелание остаётся; на первом шаге назад некуда", () => {
  const atConfirm = run(startBooking(env()), [...toGuests, text("4"), text("Анна"), act("me"), text("у окна")]);
  const back = advanceBooking(atConfirm.state as BookingState, act("back"), env());
  assertEquals(back.state.step, "contact");
  assertEquals((back.state as BookingState).data.contact, undefined);
  assertEquals((back.state as BookingState).data.comment, "у окна");

  const first = advanceBooking(startBooking(env()).state as BookingState, act("back"), env());
  assertEquals(first.state.step, "date");
  assertEquals(first.reply.error, "unavailable");
});

const CHANGE = { replacesId: "22222222-2222-3333-4444-555555555555", guests: 4, name: "Анна", contact: "@anna_k", comment: "у окна" };

Deno.test("изменение брони: дата → период → час → гости → сводка, без имени/контакта/комментария", () => {
  let r = startBooking(env(), CHANGE);
  assertEquals((r.state as BookingState).data, { name: "Анна", contact: "@anna_k", comment: "у окна" });
  r = run(r, [act("d=2026-10-21"), act("p=dinner"), act("h=20")]);
  assertEquals(r.reply.screen, { screen: "ask_guests", keepGuests: 4 });

  r = advanceBooking(r.state as BookingState, text("5"), env());
  assertEquals(r.state.step, "confirm");
  assertEquals((r.state as BookingState).data.guests, 5);
  assertEquals((r.reply.screen as { isChange?: boolean }).isChange, true);
  assertEquals((r.state as BookingState).change?.replacesId, CHANGE.replacesId);
});

Deno.test("изменение: «Оставить N» сохраняет число гостей исходной брони", () => {
  const r = run(startBooking(env(), CHANGE), [act("d=2026-10-21"), act("p=dinner"), act("h=20"), act("keep")]);
  assertEquals(r.state.step, "confirm");
  assertEquals((r.state as BookingState).data.guests, 4);
});

Deno.test("«Оставить N» вне режима изменения не работает", () => {
  const r = run(startBooking(env()), [...toGuests, act("keep")]);
  assertEquals(r.reply.error, "unavailable");
  assertEquals(r.state.step, "guests");
});

Deno.test("изменение: «Назад» со сводки идёт к гостям (имя и контакт пропущены), «Начать заново» не теряет режим", () => {
  const atConfirm = run(startBooking(env(), CHANGE), [act("d=2026-10-21"), act("p=dinner"), act("h=20"), act("keep")]);
  const back = advanceBooking(atConfirm.state as BookingState, act("back"), env());
  assertEquals(back.state.step, "guests");

  const restarted = advanceBooking(atConfirm.state as BookingState, act("restart"), env());
  assertEquals(restarted.state.step, "date");
  assertEquals((restarted.state as BookingState).change, CHANGE);
  assertEquals((restarted.state as BookingState).data.name, "Анна");
});

Deno.test("изменение: слот пропал → откат на выбор даты, предзаполненные данные сохраняются", () => {
  const e1 = env();
  const atHour = run(startBooking(e1, CHANGE), [act("d=2026-10-13"), act("p=dinner")], e1);
  const late = env({ now: new Date("2026-10-13T19:45:00Z") });
  const r = advanceBooking(atHour.state as BookingState, act("h=19"), late);
  assertEquals(r.state.step, "date");
  assertEquals((r.state as BookingState).data, { name: "Анна", contact: "@anna_k", comment: "у окна" });
});

Deno.test("шаг «имя»: вопрос вместо имени не принимается (name_unlikely)", () => {
  const r = run(startBooking(env()), [...toGuests, text("4"), text("а детские стулья есть?")]);
  assertEquals(r.state.step, "name");
  assertEquals(r.reply.error, "name_unlikely");
});

Deno.test("сводка «Что-нибудь ещё?»: текст дописывается в пожелания, вопрос — нет", () => {
  const atConfirm = run(startBooking(env()), [...toGuests, text("4"), text("Анна"), act("me")]);
  let r = advanceBooking(atConfirm.state as BookingState, text("у окна"), env());
  assertEquals(r.state.step, "confirm");
  r = advanceBooking(r.state as BookingState, text("детский стул"), env());
  assertEquals((r.state as BookingState).data.comment, "у окна, детский стул");
  assert(r.reply.screen.screen === "confirm" && r.reply.screen.summary.includes("у окна, детский стул"));

  const question = advanceBooking(r.state as BookingState, text("а парковка есть?"), env());
  assertEquals(question.reply.error, "comment_unlikely");
  assertEquals((question.state as BookingState).data.comment, "у окна, детский стул");
});

Deno.test("шаг имени: имя с телефоном одним сообщением, кнопка Telegram, только телефон", () => {
  const atName = run(startBooking(env()), [...toGuests, text("4")]);
  assertEquals(atName.reply.screen, { screen: "ask_name", withContact: true, telegram: { name: "Анна", username: "anna_k" } });

  const both = advanceBooking(atName.state as BookingState, text("Пётр +30 690 123 4567"), env());
  assertEquals(both.state.step, "confirm");
  assertEquals([(both.state as BookingState).data.name, (both.state as BookingState).data.contact], ["Пётр", "+306901234567"]);

  const tg = advanceBooking(atName.state as BookingState, act("tg"), env());
  assertEquals(tg.state.step, "confirm");
  assertEquals([(tg.state as BookingState).data.name, (tg.state as BookingState).data.contact], ["Анна", "@anna_k"]);

  // Имя в профиле — эмодзи и ник: кнопка даёт только контакт, имя спрашивается дальше.
  const emoji = advanceBooking(atName.state as BookingState, act("tg"), env({ firstName: "🦊 xX_fox_Xx 2000" }));
  assertEquals(emoji.state.step, "name");
  assertEquals((emoji.state as BookingState).data.contact, "@anna_k");

  // Только телефон — контакт принят, имя спрашивается снова (без «Использовать Telegram»: контакт уже есть).
  const phoneOnly = advanceBooking(atName.state as BookingState, text("+30 690 123 4567"), env());
  assertEquals(phoneOnly.state.step, "name");
  assertEquals(phoneOnly.reply.screen, { screen: "ask_name", withContact: false, telegram: null });
});

// ---------------------------------------------------------------- «✏️ Исправить» на карточке (S09)

const toCard: FlowInput[] = [...toGuests, text("3"), text("Анна"), act("me"), text("у окна")];
const cardData: BookingData = { date: "2026-10-20", period: "dinner", time: "19:00", guests: 3, name: "Анна", contact: "@anna_k", comment: "у окна" };

Deno.test("исправить: меню пунктов; число гостей → шаг гостей → снова карточка, остальное на месте", () => {
  const menu = run(startBooking(env()), [...toCard, act("edit")]);
  assertEquals(menu.state.step, "edit");
  assertEquals(menu.reply.screen, { screen: "edit_menu", flow: "booking", fields: ["date", "time", "guests", "name", "contact", "comment"] });

  const asked = run(menu, [act("e=guests")]);
  assertEquals(asked.state.step, "guests");
  const done = run(asked, [text("4")]);
  assertEquals(done.state.step, "confirm");
  assertEquals((done.state as BookingState).data, { ...cardData, guests: 4 });
  assertEquals((done.state as BookingState).editFrom, undefined, "снимок «до» снят на карточке");
});

Deno.test("исправить время: период и час заново, дата и гости остаются — после часа сразу карточка", () => {
  const r = run(startBooking(env()), [...toCard, act("edit"), act("e=time")]);
  assertEquals(r.state.step, "period");
  const done = run(r, [act("p=dinner"), act("h=21")]);
  assertEquals(done.state.step, "confirm");
  assertEquals((done.state as BookingState).data, { ...cardData, time: "21:00" });
});

Deno.test("исправить дату: стирает и время; на шаге даты есть «Назад»", () => {
  const r = run(startBooking(env()), [...toCard, act("edit"), act("e=date")]);
  assertEquals(r.state.step, "date");
  assert(r.reply.screen.screen === "ask_date" && r.reply.screen.editing === true);
  const done = run(r, [act("d=2026-10-21"), act("p=dinner"), act("h=20")]);
  assertEquals(done.state.step, "confirm");
  assertEquals((done.state as BookingState).data, { ...cardData, date: "2026-10-21", time: "20:00" });
});

Deno.test("исправить: «Назад» посреди исправления — данные до него и карточка, ничего не потеряно", () => {
  const midway = run(startBooking(env()), [...toCard, act("edit"), act("e=time"), act("p=dinner")]);
  assertEquals(midway.state.step, "hour");
  const back = run(midway, [act("back")]);
  assertEquals(back.state.step, "confirm");
  assertEquals((back.state as BookingState).data, cardData);
  assertEquals((back.state as BookingState).editFrom, undefined);
});

Deno.test("исправить: «← К заявке» из меню — карточка без изменений; текст в меню не пожелание", () => {
  const menu = run(startBooking(env()), [...toCard, act("edit")]);
  const typed = run(menu, [text("ещё детский стул")]);
  assertEquals(typed.state.step, "edit");
  assertEquals(typed.reply.error, "use_buttons");
  const back = run(menu, [act("back")]);
  assertEquals(back.state.step, "confirm");
  assertEquals((back.state as BookingState).data, cardData);
});

Deno.test("исправить пожелания: стёрты, сразу карточка — новые пишутся там", () => {
  const r = run(startBooking(env()), [...toCard, act("edit"), act("e=comment")]);
  assertEquals(r.state.step, "confirm");
  assertEquals((r.state as BookingState).data.comment, null);
  const added = run(r, [text("детский стул")]);
  assertEquals((added.state as BookingState).data.comment, "детский стул");
});

Deno.test("исправить при изменении брони: только дата, время, гости; имя чужим действием не стереть", () => {
  const change = { replacesId: "b-1", guests: 2, name: "Анна", contact: "@anna_k", comment: null };
  const card = run(startBooking(env(), change), [...toGuests, act("keep")]);
  assertEquals(card.state.step, "confirm");
  const menu = run(card, [act("edit")]);
  assertEquals(menu.reply.screen, { screen: "edit_menu", flow: "booking", fields: ["date", "time", "guests"] });
  const denied = run(menu, [act("e=name")]);
  assertEquals([denied.state.step, denied.reply.error], ["edit", "unavailable"]);
});

Deno.test("исправить: на карточке ✏️ только у изменённого пункта; без изменений — без пометок", () => {
  const done = run(startBooking(env()), [...toCard, act("edit"), act("e=guests"), text("4")]);
  assert(done.reply.screen.screen === "confirm");
  const summary = done.reply.screen.summary;
  assert(summary.includes("👥 Гостей: 4 ✏️"));
  assertEquals((summary.match(/✏️/g) ?? []).length, 1);

  // Ввели то же число — менять нечего, пометки нет.
  const same = run(startBooking(env()), [...toCard, act("edit"), act("e=guests"), text("3")]);
  assert(same.reply.screen.screen === "confirm" && !same.reply.screen.summary.includes("✏️"));
});
