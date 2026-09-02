import type { CurrencyCode } from "../../domain/currencyCode.js";
import {
  ALIAS_TO_CODE,
  RECOGNISED_TERMS,
} from "../../domain/currencies.js";

export interface CurrencyQuery {
  /** Сумма перед первой валютой ("100 EUR") или null, если её нет. */
  amount: number | null;
  /** Коды в порядке появления, без дублей. Первый — источник, второй — цель. */
  codes: CurrencyCode[];
}

/**
 * Разбирает свободный текст: находит валюты (коды ISO или синонимы: "евро",
 * "долларов", "фунтов") и, если есть, число перед первой из них.
 *
 * Примеры:
 *   "курс eur"              -> { amount: null, codes: [EUR] }
 *   "100 евро в долларах"   -> { amount: 100,  codes: [EUR, USD] }
 *   "сколько 50 USD в GBP"  -> { amount: 50,   codes: [USD, GBP] }
 *
 * Разделители тысяч не поддерживаем: "1000" — да, "1 000"/"1,000" — нет.
 * Десятичный разделитель — точка или запятая: "100.5", "100,5".
 */
export function parseCurrencyQuery(text: string): CurrencyQuery {
  const normalized = text.toLowerCase();

  // Термин — на границе слова (\b в JS не дружит с кириллицей, берём lookaround).
  // Слева запрещаем только букву (цифру разрешаем — это может быть сумма: "100евро").
  // Справа запрещаем и букву, и цифру.
  const termGroup = RECOGNISED_TERMS.map(escapeRegExp).join("|");
  const re = new RegExp(
    String.raw`(?:(\d+(?:[.,]\d+)?)\s*)?(?<!\p{L})(${termGroup})(?![\p{L}\p{N}])`,
    "giu",
  );

  const seen = new Set<CurrencyCode>();
  const codes: CurrencyCode[] = [];
  let amount: number | null = null;

  for (const match of normalized.matchAll(re)) {
    const rawAmount = match[1];
    const term = match[2]?.toLowerCase();
    if (!term) continue;

    const code = ALIAS_TO_CODE.get(term);
    if (!code || seen.has(code)) continue;

    // Сумму берём только у первой найденной валюты.
    if (codes.length === 0 && rawAmount !== undefined) {
      const parsed = Number(rawAmount.replace(",", "."));
      if (Number.isFinite(parsed) && parsed > 0) {
        amount = parsed;
      }
    }

    seen.add(code);
    codes.push(code);
  }

  return { amount, codes };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
