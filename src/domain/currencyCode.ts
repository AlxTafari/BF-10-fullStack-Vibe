import { ALIAS_TO_CODE, KNOWN_CURRENCY_CODES } from "./currencies.js";
import { UnknownCurrencyError } from "./errors.js";

/**
 * Код валюты ISO 4217 (три буквы, uppercase).
 * Branded type: обычная строка не подставится туда, где ждут CurrencyCode,
 * без явной проверки через toCurrencyCode / isCurrencyCode.
 */
export type CurrencyCode = string & { readonly __brand: "CurrencyCode" };

export { KNOWN_CURRENCY_CODES };

export function isCurrencyCode(value: string): value is CurrencyCode {
  return KNOWN_CURRENCY_CODES.has(value.toUpperCase());
}

/**
 * Нормализует ввод к CurrencyCode или бросает UnknownCurrencyError.
 * Принимает и код ("eur", "EUR"), и синоним ("евро", "доллар", "фунтов").
 */
export function toCurrencyCode(value: string): CurrencyCode {
  const key = value.trim().toLowerCase();
  const byAlias = ALIAS_TO_CODE.get(key);
  if (byAlias) {
    return byAlias;
  }
  const upper = value.trim().toUpperCase();
  if (isCurrencyCode(upper)) {
    return upper as CurrencyCode;
  }
  throw new UnknownCurrencyError(value);
}
