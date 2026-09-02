import { describe, expect, it } from "vitest";
import { extractCurrencyCodes } from "../src/application/parsing/extractCurrencyCodes.js";

describe("extractCurrencyCodes", () => {
  it("находит один код в свободном тексте", () => {
    expect(extractCurrencyCodes("какой курс eur сегодня?")).toEqual(["EUR"]);
  });

  it("находит два кода с сохранением порядка", () => {
    expect(extractCurrencyCodes("EUR to GBP")).toEqual(["EUR", "GBP"]);
  });

  it("игнорирует трёхбуквенные слова, которых нет в списке", () => {
    expect(extractCurrencyCodes("THE USD FOR YOU")).toEqual(["USD"]);
  });

  it("убирает дубли", () => {
    expect(extractCurrencyCodes("USD USD eur")).toEqual(["USD", "EUR"]);
  });

  it("возвращает пустой массив, если кодов нет", () => {
    expect(extractCurrencyCodes("привет, бот")).toEqual([]);
  });
});
