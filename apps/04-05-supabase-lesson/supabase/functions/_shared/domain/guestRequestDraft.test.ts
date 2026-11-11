import { assertEquals } from "@std/assert";
import { startBooking } from "./bookingFlow.ts";
import type { FlowEnv, GuestRequestState } from "./flowState.ts";
import { applyGuestRequestDraft } from "./guestRequestDraft.ts";
import { advanceGuestRequest } from "./guestRequestFlow.ts";

const env = (over: Partial<FlowEnv> = {}): FlowEnv => ({
  now: new Date("2026-10-13T12:00:00Z"),
  timeZone: "Europe/Athens",
  openingHours: null,
  username: "anna_k",
  newDraftId: () => "22222222-2222-3333-4444-555555555555",
  ...over,
});

Deno.test("жалоба из фразы → шаг «контакт» (можно пропустить кнопкой)", () => {
  const o = applyGuestRequestDraft(null, { kind: "complaint", text: "Долго несли горячее" }, env());
  const s = o.result.state as GuestRequestState;
  assertEquals(s.step, "contact");
  assertEquals(o.missing, ["contact"]);
  assertEquals(o.result.reply.screen, { screen: "ask_contact", canUseUsername: true, optional: true });
  // «Пропустить» — обычный шаг сценария.
  const skipped = advanceGuestRequest(s, { type: "action", action: "skip" }, env());
  assertEquals(skipped.state.step, "confirm");
});

Deno.test("вопрос менеджеру с контактом → сразу сводка", () => {
  const o = applyGuestRequestDraft(null, { kind: "manager_request", text: "Можно ли с собакой?", contact: "@anna_k" }, env());
  assertEquals(o.result.state.step, "confirm");
  assertEquals(o.result.reply.screen.screen, "confirm");
});

Deno.test("неизвестный тип и пустой текст не пишутся", () => {
  const o = applyGuestRequestDraft(null, { kind: "order", text: "  " }, env());
  assertEquals(o.errors, { kind: "bad_kind", text: "text_empty" });
  assertEquals(o.result.state.step, "kind");
});

Deno.test("смена типа на вопрос менеджеру отменяет пропуск контакта", () => {
  const complaint = applyGuestRequestDraft(null, { kind: "complaint", text: "Холодный суп" }, env()).result.state as GuestRequestState;
  const skipped = advanceGuestRequest(complaint, { type: "action", action: "skip" }, env()).state;
  const o = applyGuestRequestDraft(skipped, { kind: "manager_request" }, env());
  assertEquals(o.result.state.step, "contact");
  assertEquals((o.result.state as GuestRequestState).data.contact, undefined);
});

Deno.test("живая бронь заменяется обращением", () => {
  const booking = startBooking(env()).state;
  const s = applyGuestRequestDraft(booking, { kind: "manager_request" }, env()).result.state;
  assertEquals(s.flow, "guest_request");
  assertEquals(s.step, "text");
});
