import { describe, expect, it } from "vitest";
import { parseCurrencyQuery } from "../src/application/parsing/parseCurrencyQuery.js";

describe("parseCurrencyQuery", () => {
  it("находит код в свободном тексте", () => {
    expect(parseCurrencyQuery("какой курс eur сегодня?")).toEqual({
      amount: null,
      codes: ["EUR"],
    });
  });

  it("находит два кода с сохранением порядка", () => {
    expect(parseCurrencyQuery("EUR to GBP").codes).toEqual(["EUR", "GBP"]);
  });

  it("понимает русские названия валют", () => {
    expect(parseCurrencyQuery("сколько евро в рублях").codes).toEqual([
      "EUR",
      "RUB",
    ]);
  });

  it("понимает словоформы: долларов, фунтов", () => {
    expect(parseCurrencyQuery("50 долларов в фунтах")).toEqual({
      amount: 50,
      codes: ["USD", "GBP"],
    });
  });

  it("понимает предложные формы: юанях, иенах", () => {
    expect(parseCurrencyQuery("5000 рублей в юанях")).toEqual({
      amount: 5000,
      codes: ["RUB", "CNY"],
    });
  });

  it("вытаскивает сумму перед первой валютой", () => {
    expect(parseCurrencyQuery("100 EUR в USD")).toEqual({
      amount: 100,
      codes: ["EUR", "USD"],
    });
  });

  it("десятичный разделитель — точка или запятая", () => {
    expect(parseCurrencyQuery("10,5 usd").amount).toBe(10.5);
    expect(parseCurrencyQuery("10.5 usd").amount).toBe(10.5);
  });

  it("не считает валютой обычные трёхбуквенные слова", () => {
    expect(parseCurrencyQuery("the usd for you").codes).toEqual(["USD"]);
  });

  it("не ловит валюту внутри другого слова", () => {
    expect(parseCurrencyQuery("еврокомиссия одобрила").codes).toEqual([]);
  });

  it("убирает дубли", () => {
    expect(parseCurrencyQuery("USD USD eur").codes).toEqual(["USD", "EUR"]);
  });

  it("пустой результат, если валют нет", () => {
    expect(parseCurrencyQuery("привет, бот")).toEqual({
      amount: null,
      codes: [],
    });
  });
});
