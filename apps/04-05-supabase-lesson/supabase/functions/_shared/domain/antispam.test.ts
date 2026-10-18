import { assertEquals } from "jsr:@std/assert@1";
import { countsTowardRateLimit, isTooLong, MAX_GUEST_TEXT_LENGTH, parseRateDecision } from "./antispam.ts";

Deno.test("isTooLong: граница 500/501 символов", () => {
  assertEquals(isTooLong("а".repeat(MAX_GUEST_TEXT_LENGTH)), false);
  assertEquals(isTooLong("а".repeat(MAX_GUEST_TEXT_LENGTH + 1)), true);
  assertEquals(isTooLong(""), false);
});

Deno.test("isTooLong: считает символы Unicode, а не единицы UTF-16", () => {
  // 500 эмодзи = 1000 единиц UTF-16, но 500 символов — проходит.
  assertEquals(isTooLong("🍷".repeat(500)), false);
  assertEquals(isTooLong("🍷".repeat(501)), true);
});

Deno.test("parseRateDecision: незнакомое значение = allowed (fail open)", () => {
  assertEquals(parseRateDecision("warn"), "warn");
  assertEquals(parseRateDecision("drop"), "drop");
  assertEquals(parseRateDecision("allowed"), "allowed");
  assertEquals(parseRateDecision(null), "allowed");
  assertEquals(parseRateDecision("что-то новое"), "allowed");
});

Deno.test("countsTowardRateLimit: сценарий брони в лимит не идёт", () => {
  assertEquals(countsTowardRateLimit({ isFlowCallback: false, hasLiveFlow: false }), true);
  assertEquals(countsTowardRateLimit({ isFlowCallback: true, hasLiveFlow: true }), false);
  assertEquals(countsTowardRateLimit({ isFlowCallback: false, hasLiveFlow: true }), false);
  assertEquals(countsTowardRateLimit({ isFlowCallback: true, hasLiveFlow: false }), false);
});
