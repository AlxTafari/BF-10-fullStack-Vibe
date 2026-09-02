import type { Conversion } from "./useCases/convertCurrency.js";
import type { RateAgainstUsd } from "./useCases/getRateAgainstUsd.js";

/**
 * Тексты ответов бота. Чистые функции без привязки к Telegram —
 * webhook-адаптер просто берёт строку и отправляет.
 */

export const HELP_TEXT = [
  "Пришли код валюты (ISO 4217) — отвечу курсом к доллару США.",
  "",
  "Примеры:",
  "• EUR — курс евро к USD",
  "• EUR GBP — курс евро к фунту",
  "• «сколько стоит JPY» — тоже пойму",
  "",
  "Команды: /help",
].join("\n");

export const NO_CODE_FOUND =
  'Не нашёл код валюты. Пример: EUR или "EUR GBP".';

export const PROVIDER_UNAVAILABLE =
  "Источник курсов сейчас недоступен, попробуй позже.";

export function unknownCurrency(code: string): string {
  return `Не знаю валюту «${code}». Нужен трёхбуквенный код ISO 4217, например EUR.`;
}

export function formatRateAgainstUsd(r: RateAgainstUsd): string {
  return [
    `${r.code} / USD`,
    `1 USD = ${fmt(r.perUsd)} ${r.code}`,
    `1 ${r.code} = ${fmt(r.usdPerUnit)} USD`,
    "",
    `Источник: ${r.provider} · ${dateOnly(r.asOf)}`,
  ].join("\n");
}

export function formatConversion(c: Conversion): string {
  return [
    `${c.from} / ${c.to}`,
    `1 ${c.from} = ${fmt(c.rate)} ${c.to}`,
    `1 ${c.to} = ${fmt(c.inverseRate)} ${c.from}`,
    "",
    `Источник: ${c.provider} · ${dateOnly(c.asOf)}`,
  ].join("\n");
}

/** 6 значащих цифр, без хвостовых нулей. */
function fmt(n: number): string {
  return Number(n.toPrecision(6)).toString();
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
