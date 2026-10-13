import { assert, assertEquals } from "jsr:@std/assert@1";
import { advanceBooking, startBooking } from "./bookingFlow.ts";
import type { AdvanceResult, BookingState, FlowEnv, FlowInput } from "./flowState.ts";

const HOURS = Object.fromEntries(
  ["2", "3", "4", "5", "6", "7"].map((d) => [d, { open: "13:00", close: "24:00" }]),
);
// Вторник 2026-10-13, 15:00 в Афинах.
const env = (over: Partial<FlowEnv> = {}): FlowEnv => ({
  now: new Date("2026-10-13T12:00:00Z"),
  timeZone: "Europe/Athens",
  openingHours: HOURS,
  username: "anna_k",
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
    act("skip"),
  ]);
  assertEquals(r.state.step, "confirm");
  assertEquals((r.state as BookingState).data, {
    date: "2026-10-20",
    period: "dinner",
    time: "19:00",
    guests: 4,
    name: "Анна",
    contact: "@anna_k",
    comment: null, // «Пропустить» = null, не пустая строка
  });
  assertEquals(r.reply.screen.screen, "confirm");

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

Deno.test("«Назад» со сводки стирает комментарий; на первом шаге назад некуда", () => {
  const atConfirm = run(startBooking(env()), [...toGuests, text("4"), text("Анна"), act("me"), act("skip")]);
  const back = advanceBooking(atConfirm.state as BookingState, act("back"), env());
  assertEquals(back.state.step, "comment");
  assertEquals((back.state as BookingState).data.comment, undefined);
  assertEquals((back.state as BookingState).data.contact, "@anna_k");

  const first = advanceBooking(startBooking(env()).state as BookingState, act("back"), env());
  assertEquals(first.state.step, "date");
  assertEquals(first.reply.error, "unavailable");
});
