import { assertEquals } from "@std/assert";
import { resolveAgentContact } from "./agentContact.ts";
import type { FlowEnv } from "./flowState.ts";

const env = (over: Partial<FlowEnv> = {}): FlowEnv => ({
  now: new Date("2026-10-13T12:00:00Z"),
  timeZone: "Europe/Athens",
  openingHours: null,
  username: "AlxTafari",
  firstName: "Александр",
  newDraftId: () => "id",
  ...over,
});

Deno.test("resolveAgentContact: useTelegram → настоящий @username из апдейта", () => {
  assertEquals(resolveAgentContact({ useTelegram: true }, env()), { kind: "ok", value: "@AlxTafari" });
});

Deno.test("resolveAgentContact: useTelegram важнее шаблонного ника от модели", () => {
  assertEquals(resolveAgentContact({ useTelegram: true, contact: "@username" }, env()), { kind: "ok", value: "@AlxTafari" });
});

Deno.test("resolveAgentContact: useTelegram без @username у гостя — no_telegram_username", () => {
  assertEquals(resolveAgentContact({ useTelegram: true }, env({ username: null })), { kind: "error", error: "no_telegram_username" });
});

Deno.test("resolveAgentContact: шаблон вместо ника — contact_placeholder, регистр не важен", () => {
  assertEquals(resolveAgentContact({ contact: "@username" }, env()), { kind: "error", error: "contact_placeholder" });
  assertEquals(resolveAgentContact({ contact: "@UserName" }, env()), { kind: "error", error: "contact_placeholder" });
});

Deno.test("resolveAgentContact: телефон и названный гостем ник — как раньше; нет контакта — none", () => {
  assertEquals(resolveAgentContact({ contact: "+30 690 123 4567" }, env()), { kind: "ok", value: "+306901234567" });
  assertEquals(resolveAgentContact({ contact: "@maria_k" }, env()), { kind: "ok", value: "@maria_k" });
  assertEquals(resolveAgentContact({ contact: "позвоните" }, env()), { kind: "error", error: "contact_invalid" });
  assertEquals(resolveAgentContact({}, env()), { kind: "none" });
});
