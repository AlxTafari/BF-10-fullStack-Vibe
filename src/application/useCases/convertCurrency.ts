import { toCurrencyCode } from "../../domain/currencyCode.js";
import type { RatesProvider } from "../ports/RatesProvider.js";
import { crossRate } from "../rateMath.js";

export interface Conversion {
  from: string;
  to: string;
  /** 1 from = rate to */
  rate: number;
  /** 1 to = inverseRate from */
  inverseRate: number;
  /** Сумма из запроса ("100 EUR в GBP"), если была. */
  amount: number | null;
  /** amount from в валюте to, если amount задан. */
  converted: number | null;
  asOf: Date;
  provider: string;
}

/**
 * Конвертер: два кода валют (или синонима) — курс одной к другой.
 * Если передана сумма — посчитать результат перевода.
 */
export async function convertCurrency(
  rawFrom: string,
  rawTo: string,
  provider: RatesProvider,
  amount: number | null = null,
): Promise<Conversion> {
  const from = toCurrencyCode(rawFrom);
  const to = toCurrencyCode(rawTo);
  const snap = await provider.getSnapshot();

  const rate = crossRate(snap, from, to);
  return {
    from,
    to,
    rate,
    inverseRate: 1 / rate,
    amount,
    converted: amount === null ? null : amount * rate,
    asOf: new Date(snap.timestamp),
    provider: snap.providerName,
  };
}
