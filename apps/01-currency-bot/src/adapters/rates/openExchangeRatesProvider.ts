import type { CurrencyCode } from "../../domain/currencyCode.js";
import { RatesProviderError } from "../../domain/errors.js";
import type {
  RateSnapshot,
  RatesProvider,
} from "../../application/ports/RatesProvider.js";

/**
 * Open Exchange Rates — https://openexchangerates.org
 * Бесплатный тариф: база только USD, обновление раз в час, ~1000 запросов/мес.
 * Нам это подходит: всё в задании считается относительно USD.
 */

const ENDPOINT = "https://openexchangerates.org/api/latest.json";

interface OxrLatestResponse {
  timestamp: number; // секунды
  base: string;
  rates: Record<string, number>;
}

export interface OxrProviderOptions {
  appId: string;
  /** Сколько держать ответ в памяти, мс. По умолчанию 10 минут (лимит запросов). */
  cacheTtlMs?: number;
  /** Подмена fetch в тестах. */
  fetchImpl?: typeof fetch;
}

export function createOpenExchangeRatesProvider(
  options: OxrProviderOptions,
): RatesProvider {
  const ttl = options.cacheTtlMs ?? 10 * 60_000;
  const doFetch = options.fetchImpl ?? fetch;
  const name = "openexchangerates.org";

  let cache: { at: number; snap: RateSnapshot } | null = null;

  return {
    name,
    async getSnapshot(): Promise<RateSnapshot> {
      if (cache && Date.now() - cache.at < ttl) {
        return cache.snap;
      }

      const url = `${ENDPOINT}?app_id=${encodeURIComponent(options.appId)}`;
      let response: Response;
      try {
        response = await doFetch(url);
      } catch (err) {
        throw new RatesProviderError("OXR: запрос не выполнен", err);
      }

      if (!response.ok) {
        throw new RatesProviderError(`OXR: HTTP ${response.status}`);
      }

      const body = (await response.json()) as OxrLatestResponse;
      if (body.base !== "USD" || typeof body.rates !== "object") {
        throw new RatesProviderError("OXR: неожиданный формат ответа");
      }

      const snap: RateSnapshot = {
        base: "USD" as CurrencyCode,
        rates: body.rates,
        timestamp: body.timestamp * 1000,
        providerName: name,
      };
      cache = { at: Date.now(), snap };
      return snap;
    },
  };
}
