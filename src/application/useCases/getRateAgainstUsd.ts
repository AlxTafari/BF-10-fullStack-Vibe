import { toCurrencyCode } from "../../domain/currencyCode.js";
import type { RatesProvider } from "../ports/RatesProvider.js";
import { crossRate } from "../rateMath.js";

export interface RateAgainstUsd {
  code: string;
  /** 1 USD = perUsd <code> */
  perUsd: number;
  /** 1 <code> = usdPerUnit USD */
  usdPerUnit: number;
  /** Сумма из запроса ("100 EUR"), если была. */
  amount: number | null;
  /** amount <code> в USD, если amount задан. */
  amountInUsd: number | null;
  asOf: Date;
  provider: string;
}

/**
 * Основной сценарий: дали код (или синоним) валюты — вернуть её курс к USD.
 * Если передана сумма — посчитать, сколько это в долларах.
 */
export async function getRateAgainstUsd(
  rawCode: string,
  provider: RatesProvider,
  amount: number | null = null,
): Promise<RateAgainstUsd> {
  const code = toCurrencyCode(rawCode);
  const usd = toCurrencyCode("USD");
  const snap = await provider.getSnapshot();

  const perUsd = crossRate(snap, usd, code); // 1 USD -> сколько code
  const usdPerUnit = 1 / perUsd;

  return {
    code,
    perUsd,
    usdPerUnit,
    amount,
    amountInUsd: amount === null ? null : amount * usdPerUnit,
    asOf: new Date(snap.timestamp),
    provider: snap.providerName,
  };
}
