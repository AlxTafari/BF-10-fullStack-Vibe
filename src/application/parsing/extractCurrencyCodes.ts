import { KNOWN_CURRENCY_CODES } from "../../domain/currencyCode.js";

/**
 * Достаёт из произвольного текста коды валют.
 * - берём трёхбуквенные токены на границах слов;
 * - оставляем только известные коды (белый список);
 * - сохраняем порядок появления, убираем дубли.
 *
 * Первый код — валюта-источник, второй (если есть) — валюта-цель.
 */
export function extractCurrencyCodes(text: string): string[] {
  const tokens = text.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of tokens) {
    if (KNOWN_CURRENCY_CODES.has(token) && !seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}
