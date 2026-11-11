import { describe, expect, it } from "vitest";
import { aiSettingsSchema, toAiFormValues, toAiSettingsUpdate } from "./aiSettingsSchema";

const values = (over: Partial<Record<"history_window" | "daily_turn_limit", string>> = {}) => ({
  ai_enabled: true,
  history_window: "12",
  daily_turn_limit: "50",
  ...over,
});

describe("aiSettingsSchema", () => {
  it("границы диапазонов включительно (как check в БД)", () => {
    expect(aiSettingsSchema.safeParse(values({ history_window: "4", daily_turn_limit: "5" })).success).toBe(true);
    expect(aiSettingsSchema.safeParse(values({ history_window: "30", daily_turn_limit: "500" })).success).toBe(true);
  });

  it.each([
    ["history_window", "3"],
    ["history_window", "31"],
    ["daily_turn_limit", "4"],
    ["daily_turn_limit", "501"],
    ["daily_turn_limit", ""],
    ["daily_turn_limit", "12.5"],
    ["history_window", "-5"],
  ] as const)("%s = «%s» отклоняется", (field, value) => {
    const result = aiSettingsSchema.safeParse(values({ [field]: value }));
    expect(result.success).toBe(false);
  });

  it("строка БД → форма → patch без потерь", () => {
    const row = { ai_enabled: false, history_window: 20, daily_turn_limit: 100 };
    expect(toAiSettingsUpdate(toAiFormValues(row))).toEqual(row);
  });
});
