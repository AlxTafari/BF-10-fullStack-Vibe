import type { HandlerDeps } from "./application/useCases/handleIncomingMessage.js";
import { createRatesProvider } from "./adapters/rates/createRatesProvider.js";
import { createTelegramMessenger } from "./adapters/telegram/telegramMessenger.js";
import type { Config } from "./config.js";

/**
 * Composition root: собираем конкретные адаптеры и отдаём их use case'у.
 * Единственное место, где создаются реальные зависимости.
 */
export function buildContainer(
  config: Config,
  logError: (err: unknown) => void = console.error,
): HandlerDeps {
  return {
    provider: createRatesProvider(config),
    messenger: createTelegramMessenger({ botToken: config.botToken }),
    logError,
  };
}
