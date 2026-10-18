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

Deno.test("countsTowardRateLimit: считается только свободный текст вне сценария", () => {
  assertEquals(countsTowardRateLimit({ isCommand: false, isCallback: false, hasLiveFlow: false }), true);
  // Команды и кнопки — навигация, в лимит не идут.
  assertEquals(countsTowardRateLimit({ isCommand: true, isCallback: false, hasLiveFlow: false }), false);
  assertEquals(countsTowardRateLimit({ isCommand: false, isCallback: true, hasLiveFlow: false }), false);
  // Текст внутри живого сценария — тоже нет.
  assertEquals(countsTowardRateLimit({ isCommand: false, isCallback: false, hasLiveFlow: true }), false);
});
