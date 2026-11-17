import { describe, expect, it } from "vitest";
import { NETWORK_ERROR_MESSAGE, toApiError } from "./errors";

describe("toApiError", () => {
  it("сохраняет message и code", () => {
    expect(toApiError({ message: "boom", code: "42501" })).toEqual({ message: "boom", code: "42501" });
  });
  it("без message и для мусора — запасной текст", () => {
    expect(toApiError({}).message).toBe("Неизвестная ошибка");
    expect(toApiError(null).message).toBe("Неизвестная ошибка");
    expect(toApiError(undefined)).toEqual({ message: "Неизвестная ошибка" });
  });
  it("сетевые сбои браузеров → понятный текст", () => {
    for (const m of ["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      expect(toApiError({ message: m }).message).toBe(NETWORK_ERROR_MESSAGE);
    }
  });
});
