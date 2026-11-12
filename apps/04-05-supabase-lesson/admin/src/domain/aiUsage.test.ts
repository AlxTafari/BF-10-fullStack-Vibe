import { describe, expect, it } from "vitest";
import { type AiUsageDay, periodRange, priceFor, summarizeAiUsage, zonedMidnight, formatUsd } from "./aiUsage";

const row = (over: Partial<AiUsageDay>): AiUsageDay => ({
  day: "2026-11-11",
  source: "agent",
  model: "gemini-3.5-flash-lite",
  turns: 0,
  calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  thought_tokens: 0,
  ms_total: 0,
  fallback_error: 0,
  fallback_timeout: 0,
  fallback_quota: 0,
  fallback_limit: 0,
  voice_transcribed: 0,
  voice_failed: 0,
  ...over,
});

describe("priceFor", () => {
  it("цена по дате действия: gemini-3.6-flash дорожает с 2027-01-01", () => {
    expect(priceFor("gemini-3.6-flash", "2026-12-31")?.inputPer1M).toBe(0.75);
    expect(priceFor("gemini-3.6-flash", "2027-01-01")?.inputPer1M).toBe(1.5);
    expect(priceFor("unknown-model", "2026-11-11")).toBeNull();
  });
});

describe("summarizeAiUsage", () => {
  it("суммы, среднее время по ходам, стоимость с «размышлениями» по цене выхода", () => {
    const s = summarizeAiUsage([
      row({ turns: 2, calls: 5, input_tokens: 1_000_000, output_tokens: 100_000, thought_tokens: 100_000, ms_total: 8000 }),
      row({ model: "", fallback_limit: 3 }),
      row({ turns: 0, fallback_timeout: 1, input_tokens: 0 }),
    ]);
    expect(s).toMatchObject({ turns: 2, calls: 5, avgMs: 4000, fallbacks: { error: 0, timeout: 1, quota: 0, limit: 3 }, unpricedModels: [] });
    // 1M × $0.30 + 0.2M × $2.50 = $0.80
    expect(s.costUsd).toBeCloseTo(0.8, 10);
  });

  it("день до и после смены цены считается каждый по своей", () => {
    const s = summarizeAiUsage([
      row({ model: "gemini-3.6-flash", day: "2026-12-31", input_tokens: 1_000_000 }),
      row({ model: "gemini-3.6-flash", day: "2027-01-01", input_tokens: 1_000_000 }),
    ]);
    expect(s.costUsd).toBeCloseTo(2.25, 10);
  });

  it("распознавание голосовых — отдельная группа: свои суммы и стоимость, в ходы агента не входит; общий итог — сумма", () => {
    const s = summarizeAiUsage([
      row({ turns: 1, calls: 1, input_tokens: 1_000_000, ms_total: 2000 }),
      row({ source: "voice", calls: 3, input_tokens: 1_000_000, output_tokens: 100_000, ms_total: 1500, voice_transcribed: 2, voice_failed: 1 }),
    ]);
    expect(s).toMatchObject({ turns: 1, calls: 1, inputTokens: 1_000_000, avgMs: 2000 });
    expect(s.voice).toMatchObject({ transcribed: 2, failed: 1, calls: 3, inputTokens: 1_000_000, outputTokens: 100_000, avgMs: 500 });
    // агент: 1M × $0.30 = $0.30; голос: 1M × $0.30 + 0.1M × $2.50 = $0.55
    expect(s.costUsd).toBeCloseTo(0.3, 10);
    expect(s.voice.costUsd).toBeCloseTo(0.55, 10);
    expect(s.totalCostUsd).toBeCloseTo(0.85, 10);
  });

  it("модель без цены в группе голоса — тоже в unpricedModels", () => {
    const s = summarizeAiUsage([row({ source: "voice", model: "whisper-x", calls: 1, input_tokens: 10, voice_transcribed: 1 })]);
    expect(s.unpricedModels).toEqual(["whisper-x"]);
    expect(s.totalCostUsd).toBe(0);
  });

  it("модель без цены — в unpricedModels, в стоимость не входит; ходов нет — avgMs null", () => {
    const s = summarizeAiUsage([row({ model: "gemini-9-pro", input_tokens: 500 })]);
    expect(s.unpricedModels).toEqual(["gemini-9-pro"]);
    expect(s.costUsd).toBe(0);
    expect(s.avgMs).toBeNull();
  });
});

describe("periodRange / zonedMidnight", () => {
  it("полночь в поясе ресторана, в т.ч. в день перехода на зимнее время", () => {
    expect(zonedMidnight("2026-11-11", "Europe/Athens").toISOString()).toBe("2026-11-10T22:00:00.000Z");
    expect(zonedMidnight("2026-07-01", "Europe/Athens").toISOString()).toBe("2026-06-30T21:00:00.000Z");
    // 25 октября 2026 Афины переходят на зимнее время в 04:00 — полночь ещё по летнему (UTC+3).
    expect(zonedMidnight("2026-10-25", "Europe/Athens").toISOString()).toBe("2026-10-24T21:00:00.000Z");
    expect(zonedMidnight("2026-10-26", "Europe/Athens").toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });

  it("«сегодня» и «7 дней» — по календарю ресторана, включая сегодня", () => {
    // 23:30 UTC 10 ноября — в Афинах уже 11-е.
    const now = new Date("2026-11-10T23:30:00Z");
    expect(periodRange("day", now, "Europe/Athens")).toEqual({ from: "2026-11-10T22:00:00.000Z", to: "2026-11-11T22:00:00.000Z" });
    expect(periodRange("week", now, "Europe/Athens").from).toBe("2026-11-04T22:00:00.000Z");
  });
});

describe("formatUsd", () => {
  it("копейки с четырьмя знаками, крупное — с двумя", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.00812)).toBe("$0.0081");
    expect(formatUsd(12.345)).toBe("$12.35");
  });
});
