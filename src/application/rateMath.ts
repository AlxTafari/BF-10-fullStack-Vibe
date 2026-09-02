import type { CurrencyCode } from "../domain/currencyCode.js";
import { RateNotAvailableError } from "../domain/errors.js";
import type { RateSnapshot } from "./ports/RatesProvider.js";

/** Сколько единиц `code` за 1 единицу базовой валюты снимка. */
export function unitsPerBase(snap: RateSnapshot, code: CurrencyCode): number {
  if (code === snap.base) return 1;
  const value = snap.rates[code];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RateNotAvailableError(code, snap.providerName);
  }
  return value;
}

/**
 * Кросс-курс: сколько единиц `to` за 1 единицу `from`.
 * Считаем через общую базу: (to за базу) / (from за базу).
 * База сокращается, поэтому какой она валютой была — неважно.
 */
export function crossRate(
  snap: RateSnapshot,
  from: CurrencyCode,
  to: CurrencyCode,
): number {
  return unitsPerBase(snap, to) / unitsPerBase(snap, from);
}
