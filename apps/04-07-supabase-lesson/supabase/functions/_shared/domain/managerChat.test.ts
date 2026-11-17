import { assertEquals } from "@std/assert";
import { checkManagerText, isHandoffActive, MANAGER_REPLY_MAX_LENGTH } from "./managerChat.ts";

const NOW = new Date("2026-11-11T12:00:00Z");

Deno.test("isHandoffActive: метка в будущем — режим идёт, в прошлом или ровно сейчас — нет", () => {
  assertEquals(isHandoffActive("2026-11-11T12:00:01Z", NOW), true);
  assertEquals(isHandoffActive("2026-11-11T12:00:00Z", NOW), false);
  assertEquals(isHandoffActive("2026-11-11T11:30:00+00:00", NOW), false);
});

Deno.test("isHandoffActive: null и нечитаемая метка — режима нет", () => {
  assertEquals(isHandoffActive(null, NOW), false);
  assertEquals(isHandoffActive(undefined, NOW), false);
  assertEquals(isHandoffActive("не дата", NOW), false);
});

Deno.test("checkManagerText: края обрезаются, пустой и не строка — отказ", () => {
  assertEquals(checkManagerText("  Здравствуйте\n"), { ok: true, text: "Здравствуйте" });
  assertEquals(checkManagerText("   "), { ok: false });
  assertEquals(checkManagerText(42), { ok: false });
});

Deno.test("checkManagerText: предел длины включительно", () => {
  assertEquals(checkManagerText("a".repeat(MANAGER_REPLY_MAX_LENGTH)).ok, true);
  assertEquals(checkManagerText("a".repeat(MANAGER_REPLY_MAX_LENGTH + 1)), { ok: false });
});
