import { describe, expect, it } from "vitest";
import { deliveryError, isHandoffActive, joinWarning, managerChatErrorText } from "./handoff";

const NOW = Date.parse("2026-11-11T12:00:00Z");

describe("ручной режим", () => {
  it("идёт, пока метка в будущем; ровно сейчас, в прошлом, null и мусор — нет", () => {
    expect(isHandoffActive("2026-11-11T12:00:01Z", NOW)).toBe(true);
    expect(isHandoffActive("2026-11-11T12:00:00Z", NOW)).toBe(false);
    expect(isHandoffActive("2026-11-11T11:00:00+00:00", NOW)).toBe(false);
    expect(isHandoffActive(null, NOW)).toBe(false);
    expect(isHandoffActive("не дата", NOW)).toBe(false);
  });
});

describe("тексты для менеджера", () => {
  it("доставлено и не требовалось — без ошибки; blocked и failed — разные тексты", () => {
    expect(deliveryError("sent")).toBeNull();
    expect(deliveryError("skipped")).toBeNull();
    expect(deliveryError("blocked")).toContain("заблокировал");
    expect(deliveryError("failed")).toContain("ошибка Telegram");
    expect(joinWarning("sent")).toBeNull();
    expect(joinWarning("blocked")).toContain("заблокировал");
  });

  it("коды функции; неизвестный — общий текст", () => {
    expect(managerChatErrorText("handoff_inactive")).toContain("подключитесь снова");
    expect(managerChatErrorText(undefined)).toContain("попробуйте ещё раз");
  });
});
