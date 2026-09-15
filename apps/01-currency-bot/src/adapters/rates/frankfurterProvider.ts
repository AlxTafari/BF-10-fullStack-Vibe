import type { CurrencyCode } from "../../domain/currencyCode.js";
import { RatesProviderError } from "../../domain/errors.js";
import type {
  RateSnapshot,
  RatesProvider,
} from "../../application/ports/RatesProvider.js";

/**
 * Frankfurter — https://frankfurter.dev
 * Без ключа, данные ЕЦБ, обновление раз в сутки по будням (~16:00 CET).
 * Запасной / альтернативный источник (доп. фича «выбор провайдера»).
 */

const ENDPOINT = "https://api.frankfurter.dev/v1/latest";

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string; // YYYY-MM-DD
  rates: Record<string, number>;
}

export interface FrankfurterProviderOptions {
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
}

export function createFrankfurterProvider(
  options: FrankfurterProviderOptions = {},
): RatesProvider {
  const ttl = options.cacheTtlMs ?? 30 * 60_000; // курс всё равно дневной
  const doFetch = options.fetchImpl ?? fetch;
  const name = "frankfurter.dev";

  let cache: { at: number; snap: RateSnapshot } | null = null;

  return {
    name,
    async getSnapshot(): Promise<RateSnapshot> {
      if (cache && Date.now() - cache.at < ttl) {
        return cache.snap;
      }

      // base=USD — просим пересчёт сразу от доллара.
      const url = `${ENDPOINT}?base=USD`;
      let response: Response;
      try {
        response = await doFetch(url);
      } catch (err) {
        throw new RatesProviderError("Frankfurter: запрос не выполнен", err);
      }

      if (!response.ok) {
        throw new RatesProviderError(`Frankfurter: HTTP ${response.status}`);
      }

      const body = (await response.json()) as FrankfurterResponse;
      if (body.base !== "USD" || typeof body.rates !== "object") {
        throw new RatesProviderError("Frankfurter: неожиданный формат ответа");
      }

      const snap: RateSnapshot = {
        base: "USD" as CurrencyCode,
        rates: body.rates,
        // В ответе только дата без времени — берём полдень UTC как ориентир.
        timestamp: Date.parse(`${body.date}T12:00:00Z`),
        providerName: name,
      };
      cache = { at: Date.now(), snap };
      return snap;
    },
  };
}
