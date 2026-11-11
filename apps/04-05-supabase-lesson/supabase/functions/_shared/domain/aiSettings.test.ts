import { assertEquals } from "@std/assert";
import { DEFAULT_AI_SETTINGS, parseAiSettings } from "./aiSettings.ts";

Deno.test("parseAiSettings: строки нет — дефолты", () => {
  assertEquals(parseAiSettings(null), DEFAULT_AI_SETTINGS);
});

Deno.test("parseAiSettings: значения из строки", () => {
  assertEquals(parseAiSettings({ ai_enabled: false, history_window: 20, daily_turn_limit: 5 }), {
    aiEnabled: false,
    historyWindow: 20,
    dailyTurnLimit: 5,
  });
});

Deno.test("parseAiSettings: негодное поле — дефолт только для него", () => {
  const parsed = parseAiSettings({ ai_enabled: "yes", history_window: 3, daily_turn_limit: 12.5 });
  assertEquals(parsed, DEFAULT_AI_SETTINGS);
  assertEquals(parseAiSettings({ ai_enabled: false, history_window: 31 }).aiEnabled, false);
});
