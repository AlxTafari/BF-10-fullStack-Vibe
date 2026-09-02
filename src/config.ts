/**
 * Конфиг из переменных окружения. Читается один раз при старте.
 * Локально подхватывается через `node --env-file=.env`,
 * на хостинге — из панели проекта.
 */

export type RatesProviderName = "oxr" | "frankfurter";

export interface Config {
  botToken: string;
  /** Секрет, которым Telegram подписывает вебхук (header X-Telegram-Bot-Api-Secret-Token). */
  webhookSecret: string;
  ratesProvider: RatesProviderName;
  openExchangeRatesAppId: string | undefined;
  port: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Не задана переменная окружения: ${name}`);
  }
  return value;
}

function parseProviderName(raw: string | undefined): RatesProviderName {
  if (raw === undefined || raw === "oxr") return "oxr";
  if (raw === "frankfurter") return "frankfurter";
  throw new Error(
    `RATES_PROVIDER: ожидается "oxr" или "frankfurter", получено "${raw}"`,
  );
}

export function loadConfig(): Config {
  const ratesProvider = parseProviderName(process.env.RATES_PROVIDER);

  return {
    botToken: required("BOT_TOKEN"),
    webhookSecret: required("WEBHOOK_SECRET"),
    ratesProvider,
    // Обязателен только для oxr — проверку делает createRatesProvider.
    openExchangeRatesAppId: process.env.OXR_APP_ID,
    port: Number(process.env.PORT ?? "3000"),
  };
}
