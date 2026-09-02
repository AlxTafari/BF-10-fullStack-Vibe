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

// Регэксп по всем распознаваемым терминам. Зависит только от RECOGNISED_TERMS
// (константа модуля), поэтому собираем один раз, а не на каждое сообщение.
//
// Термин — на границе слова (\b в JS не дружит с кириллицей, берём lookaround).
// Слева запрещаем только букву (цифру разрешаем — это может быть сумма: "100евро").
// Справа запрещаем и букву, и цифру.
// Сумма перед термином: цифры с внутренними разделителями разрядов.
const TERM_RE = new RegExp(
  String.raw`(?:(\d+(?:[ '.,]\d+)*)\s*)?(?<!\p{L})(${RECOGNISED_TERMS.map(
    escapeRegExp,
  ).join("|")})(?![\p{L}\p{N}])`,
  "giu",
);

/** Верхняя граница суммы — отсекает годы/индексы, попавшие перед валютой случайно. */
const MAX_AMOUNT = 1e12;

/**
 * Разбирает свободный текст: находит валюты (коды ISO или синонимы: "евро",
 * "долларов", "фунтов") и, если есть, число перед первой из них.
 *
 * Примеры:
 *   "курс eur"              -> { amount: null, codes: [EUR] }
 *   "100 евро в долларах"   -> { amount: 100,  codes: [EUR, USD] }
 *   "сколько 50 USD в GBP"  -> { amount: 50,   codes: [USD, GBP] }
 *
 * Сумма: разряды можно разделять пробелом/точкой/запятой ("1 000", "1,000",
 * "1.000" — все три = 1000), десятичная часть — через точку или запятую
 * ("100.5", "100,5", "1 234,56"). Абсурдно большие значения (> 1e12) игнорируем.
 */
export function parseCurrencyQuery(text: string): CurrencyQuery {
  const normalized = text.toLowerCase();

  const seen = new Set<CurrencyCode>();
  const codes: CurrencyCode[] = [];
  let amount: number | null = null;

  for (const match of normalized.matchAll(TERM_RE)) {
    const rawAmount = match[1];
    const term = match[2]?.toLowerCase();
    if (!term) continue;

    const code = ALIAS_TO_CODE.get(term);
    if (!code || seen.has(code)) continue;

    // Сумму берём только у первой найденной валюты.
    if (codes.length === 0 && rawAmount !== undefined) {
      amount = parseAmount(rawAmount);
    }

    seen.add(code);
    codes.push(code);
  }

  return { amount, codes };
}

/**
 * Число суммы из текста. Возвращает положительное число или null.
 *
 *   "1000"      -> 1000
 *   "1 000"     -> 1000     (пробел — только разряды)
 *   "1,000"     -> 1000     (один разделитель + ровно 3 цифры после = разряды)
 *   "1.000"     -> 1000
 *   "1 234,56"  -> 1234.56
 *   "10,5"      -> 10.5
 *   "1.234.567" -> 1234567  (все разделители одинаковы, группы по 3 цифры = разряды)
 */
function parseAmount(raw: string): number | null {
  // Пробел и апостроф — исключительно группировка разрядов.
  const s = raw.replace(/[\s']/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const seps = s.match(/[.,]/g) ?? [];
  if (seps.length === 0) return bounded(Number(s));

  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const head = s.slice(0, lastSep);
  const tail = s.slice(lastSep + 1);

  // Все разделители одинаковые, целые части по 1–3 цифры, хвост ровно 3 цифры —
  // значит это всё разряды: "1,000" = 1000, "1.234.567" = 1234567.
  const allSame = seps.every((c) => c === seps[0]);
  const headGroupsOk = /^\d{1,3}(?:[.,]\d{3})*$/.test(head);
  if (allSame && headGroupsOk && tail.length === 3) {
    return bounded(Number(head.replace(/[.,]/g, "") + tail));
  }

  // Иначе последний разделитель — десятичный, все предыдущие — группировка разрядов.
  const intPart = head.replace(/[.,]/g, "");
  if (!/^\d+$/.test(intPart) || !/^\d+$/.test(tail)) return null;
  return bounded(Number(`${intPart}.${tail}`));
}

function bounded(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT ? n : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
