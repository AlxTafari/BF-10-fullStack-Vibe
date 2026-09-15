import type { CurrencyCode } from "../../src/domain/currencyCode.js";
import type {
  RateSnapshot,
  RatesProvider,
} from "../../src/application/ports/RatesProvider.js";

/** USD-базовый снимок с фиксированными курсами для тестов. */
export function fakeProvider(
  rates: Record<string, number> = { EUR: 0.9, GBP: 0.8, JPY: 150, RUB: 90, CNY: 7 },
): RatesProvider {
  const snap: RateSnapshot = {
    base: "USD" as CurrencyCode,
    rates,
    timestamp: Date.parse("2026-09-02T12:00:00Z"),
    providerName: "fake",
  };
  return {
    name: "fake",
    getSnapshot: () => Promise.resolve(snap),
  };
}
