import { assertEquals } from "jsr:@std/assert@1";
import { advanceGuestRequest, startGuestRequest } from "./guestRequestFlow.ts";
import type { FlowEnv, FlowInput, GuestRequestState } from "./flowState.ts";

const env = (over: Partial<FlowEnv> = {}): FlowEnv => ({
  now: new Date("2026-10-13T12:00:00Z"),
  timeZone: "Europe/Athens",
  openingHours: null,
  username: "anna_k",
  newDraftId: () => "11111111-2222-3333-4444-555555555555",
  ...over,
});
const act = (action: string): FlowInput => ({ type: "action", action });
const text = (t: string): FlowInput => ({ type: "text", text: t });
const step = (s: GuestRequestState, i: FlowInput) => advanceGuestRequest(s, i, env());

Deno.test("жалоба: контакт можно пропустить → null", () => {
  let r = startGuestRequest(env());
  assertEquals(r.reply.screen, { screen: "ask_kind" });
  r = step(r.state as GuestRequestState, act("k=complaint"));
  r = step(r.state as GuestRequestState, text("Долго несли счёт"));
  assertEquals(r.reply.screen, { screen: "ask_contact", canUseUsername: true, optional: true });
  r = step(r.state as GuestRequestState, act("skip"));
  assertEquals(r.state.step, "confirm");
  assertEquals((r.state as GuestRequestState).data.contact, null);
  assertEquals(step(r.state as GuestRequestState, act("send")).reply.screen, { screen: "submit" });
});

Deno.test("вопрос менеджеру: без контакта не отправить", () => {
  let r = startGuestRequest(env());
  r = step(r.state as GuestRequestState, act("k=manager_request"));
  r = step(r.state as GuestRequestState, text("Можно ли банкет?"));
  assertEquals(r.reply.screen, { screen: "ask_contact", canUseUsername: true, optional: false });
  const skipped = step(r.state as GuestRequestState, act("skip"));
  assertEquals(skipped.reply.error, "contact_required");
  assertEquals(skipped.state.step, "contact");
});

Deno.test("старт с типом (переход из брони) пропускает выбор типа", () => {
  const r = startGuestRequest(env(), "manager_request");
  assertEquals(r.state.step, "text");
  assertEquals(r.reply.screen, { screen: "ask_text", kind: "manager_request" });
});

Deno.test("пустой и слишком длинный текст отклоняются", () => {
  const r = startGuestRequest(env(), "feedback");
  assertEquals(step(r.state as GuestRequestState, text("   ")).reply.error, "text_empty");
  assertEquals(step(r.state as GuestRequestState, text("а".repeat(2001))).reply.error, "text_too_long");
});

Deno.test("битое состояние: confirm вопроса менеджеру без контакта → заново", () => {
  const broken: GuestRequestState = {
    flow: "guest_request",
    step: "confirm",
    draftId: "11111111-2222-3333-4444-555555555555",
    data: { kind: "manager_request", text: "привет", contact: null },
    touchedAt: env().now.toISOString(),
  };
  assertEquals(step(broken, act("send")).state.step, "kind");
});

Deno.test("«Назад»: из контакта к тексту стирает текст, из текста к типу — тип", () => {
  let r = startGuestRequest(env());
  r = step(r.state as GuestRequestState, act("k=feedback"));
  r = step(r.state as GuestRequestState, text("Спасибо"));
  assertEquals(r.state.step, "contact");

  r = step(r.state as GuestRequestState, act("back"));
  assertEquals(r.state.step, "text");
  assertEquals((r.state as GuestRequestState).data, { kind: "feedback" });

  r = step(r.state as GuestRequestState, act("back"));
  assertEquals(r.state.step, "kind");
  assertEquals((r.state as GuestRequestState).data, {});
});
