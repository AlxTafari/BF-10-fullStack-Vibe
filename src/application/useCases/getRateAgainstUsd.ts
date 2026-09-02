import { toCurrencyCode } from "../../domain/currencyCode.js";
import type { RatesProvider } from "../ports/RatesProvider.js";
import { crossRate } from "../rateMath.js";

export interface RateAgainstUsd {
  code: string;
  /** 1 USD = perUsd <code> */
  perUsd: number;
  /** 1 <code> = usdPerUnit USD */
  usdPerUnit: number;
  asOf: Date;
  provider: string;
}

/**
 * Use case основного сценария из задания:
 * дали код валюты — вернуть её курс относительно USD.
 */
export async function getRateAgainstUsd(
  rawCode: string,
  provider: RatesProvider,
): Promise<RateAgainstUsd> {
  const code = toCurrencyCode(rawCode);
  const usd = toCurrencyCode("USD");
  const snap = await provider.getSnapshot();

  const perUsd = crossRate(snap, usd, code); // 1 USD -> сколько code
  return {
    code,
    perUsd,
    usdPerUnit: 1 / perUsd,
    asOf: new Date(snap.timestamp),
    provider: snap.providerName,
  };
}
