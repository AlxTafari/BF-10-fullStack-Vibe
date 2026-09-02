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
  asOf: Date;
  provider: string;
}

/**
 * Доп. фича: два кода валют — вернуть курс одной к другой.
 */
export async function convertCurrency(
  rawFrom: string,
  rawTo: string,
  provider: RatesProvider,
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
    asOf: new Date(snap.timestamp),
    provider: snap.providerName,
  };
}
