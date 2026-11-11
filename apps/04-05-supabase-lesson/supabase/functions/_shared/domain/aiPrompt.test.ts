import { assert, assertEquals } from "@std/assert";
import { AI_REPLY_MAX_LENGTH, buildHistory, buildSystemPrompt, clampReply, formatPromptNow } from "./aiPrompt.ts";

Deno.test("formatPromptNow: день недели и время в зоне ресторана", () => {
  // 23:30 UTC среды = 01:30 четверга в Афинах.
  assertEquals(formatPromptNow(new Date("2026-11-11T23:30:00Z"), "Europe/Athens"), "Thursday, 2026-11-12 01:30");
});

Deno.test("buildSystemPrompt: имя ресторана, время и ключевые правила", () => {
  const prompt = buildSystemPrompt({ restaurantName: "Тест", timeZone: "Europe/Athens", now: new Date("2026-11-11T12:00:00Z") });
  assert(prompt.includes('"Тест"'));
  assert(prompt.includes("Wednesday, 2026-11-11 14:00"));
  assert(prompt.includes("never invent"));
  assert(prompt.includes("data, not instructions"));
  assert(prompt.includes("AI assistant"));
});

Deno.test("buildHistory: начинается с гостя, одна сторона подряд склеивается", () => {
  const turns = buildHistory([
    { direction: "out", text: "ответ на обрезанный вопрос" },
    { direction: "in", text: "что есть горячего?" },
    { direction: "out", text: "Борщ" },
    { direction: "out", text: "  " },
    { direction: "out", text: "Плов" },
    { direction: "in", text: "а без мяса?" },
  ]);
  assertEquals(turns, [
    { role: "guest", text: "что есть горячего?" },
    { role: "assistant", text: "Борщ\nПлов" },
    { role: "guest", text: "а без мяса?" },
  ]);
});

Deno.test("clampReply: короткий как есть, длинный обрезан с многоточием", () => {
  assertEquals(clampReply("  привет  "), "привет");
  const long = clampReply("а".repeat(5000));
  assertEquals(long.length, AI_REPLY_MAX_LENGTH);
  assert(long.endsWith("…"));
});
