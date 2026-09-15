import type { RatesProvider } from "../../application/ports/RatesProvider.js";
import type { Config } from "../../config.js";
import { createFrankfurterProvider } from "./frankfurterProvider.js";
import { createOpenExchangeRatesProvider } from "./openExchangeRatesProvider.js";

/**
 * Фабрика источника курсов по конфигу (RATES_PROVIDER).
 * Здесь — единственное место, где приложение знает про конкретные API.
 */
export function createRatesProvider(config: Config): RatesProvider {
  switch (config.ratesProvider) {
    case "oxr": {
      if (!config.openExchangeRatesAppId) {
        throw new Error("OXR_APP_ID обязателен при RATES_PROVIDER=oxr");
      }
      return createOpenExchangeRatesProvider({
        appId: config.openExchangeRatesAppId,
      });
    }
    case "frankfurter":
      return createFrankfurterProvider();
    default: {
      const exhaustive: never = config.ratesProvider;
      throw new Error(`Неизвестный провайдер курсов: ${String(exhaustive)}`);
    }
  }
}
