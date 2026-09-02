import { UnknownCurrencyError } from "./errors.js";

/**
 * Код валюты ISO 4217 (три буквы, uppercase).
 * Branded type: обычная строка не подставится туда, где ждут CurrencyCode,
 * без явной проверки через toCurrencyCode / isCurrencyCode.
 */
export type CurrencyCode = string & { readonly __brand: "CurrencyCode" };

/**
 * Белый список кодов. Нужен, чтобы в тексте вида "Хочу THE USD FOR EUR"
 * не считать "THE" и "FOR" валютами. Расширяй по мере надобности —
 * это ограничение распознавания, а не самих курсов
 * (провайдер обычно знает больше валют).
 */
export const KNOWN_CURRENCY_CODES: ReadonlySet<string> = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "HKD",
  "SGD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY",
  "RUB", "UAH", "KZT", "GEL", "AMD", "AZN", "BYN", "INR", "BRL", "MXN",
  "ARS", "CLP", "COP", "ZAR", "KRW", "THB", "IDR", "MYR", "PHP", "VND",
  "ILS", "AED", "SAR", "QAR", "EGP", "ISK", "HRK",
]);

export function isCurrencyCode(value: string): value is CurrencyCode {
  return KNOWN_CURRENCY_CODES.has(value.toUpperCase());
}

/** Нормализует ввод к CurrencyCode или бросает UnknownCurrencyError. */
export function toCurrencyCode(value: string): CurrencyCode {
  const upper = value.trim().toUpperCase();
  if (!isCurrencyCode(upper)) {
    throw new UnknownCurrencyError(value);
  }
  return upper as CurrencyCode;
}
