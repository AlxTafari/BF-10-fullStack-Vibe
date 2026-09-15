import { POPULAR_CODES } from "../../domain/currencies.js";
import { toCurrencyCode } from "../../domain/currencyCode.js";
import type { RatesProvider } from "../ports/RatesProvider.js";
import { crossRate } from "../rateMath.js";

export interface PopularRate {
  code: string;
  /** 1 USD = perUsd <code> */
  perUsd: number;
}

export interface PopularRates {
  rates: PopularRate[];
  asOf: Date;
  provider: string;
}

/**
 * Команда /rates: курсы корзины популярных валют к USD за один снимок.
 * Лишних запросов нет — снимок и так кешируется в провайдере.
 */
export async function getPopularRates(
  provider: RatesProvider,
): Promise<PopularRates> {
  const usd = toCurrencyCode("USD");
  const snap = await provider.getSnapshot();

  const rates: PopularRate[] = [];
  for (const code of POPULAR_CODES) {
    try {
      rates.push({ code, perUsd: crossRate(snap, usd, code) });
    } catch {
      // валюты нет у провайдера — просто пропускаем
    }
  }

  return {
    rates,
    asOf: new Date(snap.timestamp),
    provider: snap.providerName,
  };
}
