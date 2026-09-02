import { describe, expect, it } from "vitest";
import { convertCurrency } from "../src/application/useCases/convertCurrency.js";
import { getPopularRates } from "../src/application/useCases/getPopularRates.js";
import { getRateAgainstUsd } from "../src/application/useCases/getRateAgainstUsd.js";
import { getRatesSource } from "../src/application/useCases/getRatesSource.js";
import { UnknownCurrencyError } from "../src/domain/errors.js";
import { fakeProvider } from "./support/fakeProvider.js";

describe("getRateAgainstUsd", () => {
  it("возвращает прямой и обратный курс к USD", async () => {
    const r = await getRateAgainstUsd("eur", fakeProvider());
    expect(r.code).toBe("EUR");
    expect(r.perUsd).toBeCloseTo(0.9);
    expect(r.usdPerUnit).toBeCloseTo(1 / 0.9);
    expect(r.amountInUsd).toBeNull();
  });

  it("принимает синоним валюты", async () => {
    const r = await getRateAgainstUsd("евро", fakeProvider());
    expect(r.code).toBe("EUR");
  });

  it("считает сумму в USD, если передана", async () => {
    const r = await getRateAgainstUsd("EUR", fakeProvider(), 100);
    expect(r.amount).toBe(100);
    expect(r.amountInUsd).toBeCloseTo(100 / 0.9);
  });

  it("для самого USD курс равен 1", async () => {
    const r = await getRateAgainstUsd("USD", fakeProvider());
    expect(r.perUsd).toBe(1);
  });

  it("бросает UnknownCurrencyError на левый код", async () => {
    await expect(getRateAgainstUsd("XYZ", fakeProvider())).rejects.toBeInstanceOf(
      UnknownCurrencyError,
    );
  });
});

describe("convertCurrency", () => {
  it("считает кросс-курс через общую базу", async () => {
    const c = await convertCurrency("EUR", "GBP", fakeProvider());
    expect(c.rate).toBeCloseTo(0.8 / 0.9);
    expect(c.inverseRate).toBeCloseTo(0.9 / 0.8);
    expect(c.converted).toBeNull();
  });

  it("переводит сумму", async () => {
    const c = await convertCurrency("EUR", "GBP", fakeProvider(), 100);
    expect(c.converted).toBeCloseTo((100 * 0.8) / 0.9);
  });
});

describe("getPopularRates", () => {
  it("возвращает курсы известных валют к USD", async () => {
    const p = await getPopularRates(fakeProvider());
    const eur = p.rates.find((r) => r.code === "EUR");
    expect(eur?.perUsd).toBeCloseTo(0.9);
    // JPY нет в POPULAR_CODES по умолчанию, RUB есть
    expect(p.rates.some((r) => r.code === "RUB")).toBe(true);
  });
});

describe("getRatesSource", () => {
  it("отдаёт имя провайдера и дату данных", async () => {
    const s = await getRatesSource(fakeProvider());
    expect(s.provider).toBe("fake");
    expect(s.asOf.getUTCFullYear()).toBe(2026);
  });
});
