import { describe, expect, it } from "vitest";
import { formatInZone, isOlderThan, timeAgo } from "./time";

describe("formatInZone", () => {
  // 16:00 UTC в октябре: Салоники UTC+3, Москва UTC+3, Нью-Йорк UTC-4 (летнее время)
  const iso = "2026-10-20T16:00:00+00:00";
  it("показывает время в поясе ресторана", () => {
    expect(formatInZone(iso, "Europe/Athens")).toBe("20.10.2026 19:00");
    expect(formatInZone(iso, "America/New_York")).toBe("20.10.2026 12:00");
  });
  it("полночь — 00:00, а не 24:00", () => {
    expect(formatInZone("2026-10-20T21:00:00Z", "Europe/Athens")).toBe("21.10.2026 00:00");
  });
  it("переход на зимнее время: тот же UTC-час, другой местный", () => {
    expect(formatInZone("2026-10-24T16:00:00Z", "Europe/Athens")).toBe("24.10.2026 19:00");
    expect(formatInZone("2026-10-26T16:00:00Z", "Europe/Athens")).toBe("26.10.2026 18:00");
  });
  it("формат Realtime (+00:00, микросекунды) разбирается так же, как Z", () => {
    expect(formatInZone("2026-10-14T20:24:56.947545+00:00", "UTC")).toBe(formatInZone("2026-10-14T20:24:56.947Z", "UTC"));
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it.each([
    ["2026-10-20T11:59:30Z", "только что"],
    ["2026-10-20T11:55:00Z", "5 мин назад"],
    ["2026-10-20T09:00:00Z", "3 ч назад"],
    ["2026-10-18T12:00:00Z", "2 дн назад"],
    ["2026-10-20T12:05:00Z", "только что"], // часы клиента отстают от сервера
  ])("%s → %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
});

describe("isOlderThan", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it("сравнивает с порогом", () => {
    expect(isOlderThan("2026-10-20T11:58:00Z", 60_000, now)).toBe(true);
    expect(isOlderThan("2026-10-20T11:59:30Z", 60_000, now)).toBe(false);
  });
});
