import { describe, expect, it } from "vitest";
import { convertCurrency } from "../src/application/useCases/convertCurrency.js";
import { getRateAgainstUsd } from "../src/application/useCases/getRateAgainstUsd.js";
import { UnknownCurrencyError } from "../src/domain/errors.js";
import { fakeProvider } from "./support/fakeProvider.js";

describe("getRateAgainstUsd", () => {
  it("возвращает прямой и обратный курс к USD", async () => {
    const r = await getRateAgainstUsd("eur", fakeProvider());
    expect(r.code).toBe("EUR");
    expect(r.perUsd).toBeCloseTo(0.9);
    expect(r.usdPerUnit).toBeCloseTo(1 / 0.9);
  });

  it("для самого USD курс равен 1", async () => {
    const r = await getRateAgainstUsd("USD", fakeProvider());
    expect(r.perUsd).toBe(1);
  });

  it("бросает UnknownCurrencyError на левый код", async () => {
    await expect(getRateAgainstUsd("XXX", fakeProvider())).rejects.toBeInstanceOf(
      UnknownCurrencyError,
    );
  });
});

describe("convertCurrency", () => {
  it("считает кросс-курс через общую базу", async () => {
    // 1 EUR = (USD->EUR) 0.9 ... 1 EUR в GBP: 0.8 / 0.9
    const c = await convertCurrency("EUR", "GBP", fakeProvider());
    expect(c.rate).toBeCloseTo(0.8 / 0.9);
    expect(c.inverseRate).toBeCloseTo(0.9 / 0.8);
  });
});
