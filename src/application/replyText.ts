import { currencyFlag } from "../domain/currencies.js";
import type { Conversion } from "./useCases/convertCurrency.js";
import type { PopularRates } from "./useCases/getPopularRates.js";
import type { RateAgainstUsd } from "./useCases/getRateAgainstUsd.js";
import type { RatesSource } from "./useCases/getRatesSource.js";

/**
 * Тексты ответов бота. Чистые функции без привязки к Telegram —
 * webhook-адаптер просто берёт строку и отправляет.
 */

export const HELP_TEXT = [
  "Я показываю курсы валют относительно доллара США.",
  "",
  "Просто напиши валюту — кодом или словом:",
  "• EUR или «евро» — курс к USD",
  "• EUR GBP — курс евро к фунту",
  "• 100 EUR в USD — конвертация суммы",
  "• «сколько 50 долларов в рублях»",
  "",
  "Команды:",
  "/rates — курсы популярных валют",
  "/source — текущий источник курсов",
  "/help — эта справка",
].join("\n");

export const NO_CODE_FOUND = [
  "Не нашёл валюту. Напиши код или название:",
  "EUR · «евро» · 100 USD в EUR",
].join("\n");

export const PROVIDER_UNAVAILABLE =
  "Источник курсов сейчас недоступен, попробуй позже.";

export const USD_IS_BASE =
  "USD — это база отсчёта. Назови другую валюту или пару, например EUR или USD EUR.";

export function unknownCurrency(code: string): string {
  return `Не знаю валюту «${code}». Нужен код ISO 4217 (например EUR) или знакомое название.`;
}

export function rateNotAvailable(code: string, provider: string): string {
  return [
    `У источника ${provider} нет курса для ${code}.`,
    "Основной источник (Open Exchange Rates) знает больше валют — /source.",
  ].join("\n");
}

export function formatRateAgainstUsd(r: RateAgainstUsd): string {
  const tag = withFlag(r.code);
  const lines = [
    `${tag} / 🇺🇸 USD`,
    `1 USD = ${fmt(r.perUsd)} ${r.code}`,
    `1 ${r.code} = ${fmt(r.usdPerUnit)} USD`,
  ];
  if (r.amount !== null && r.amountInUsd !== null) {
    lines.push("", `${fmt(r.amount)} ${r.code} = ${fmt(r.amountInUsd)} USD`);
  }
  lines.push("", source(r.provider, r.asOf));
  return lines.join("\n");
}

export function formatConversion(c: Conversion): string {
  const lines = [
    `${withFlag(c.from)} / ${withFlag(c.to)}`,
    `1 ${c.from} = ${fmt(c.rate)} ${c.to}`,
    `1 ${c.to} = ${fmt(c.inverseRate)} ${c.from}`,
  ];
  if (c.amount !== null && c.converted !== null) {
    lines.push("", `${fmt(c.amount)} ${c.from} = ${fmt(c.converted)} ${c.to}`);
  }
  lines.push("", source(c.provider, c.asOf));
  return lines.join("\n");
}

export function formatPopularRates(p: PopularRates): string {
  if (p.rates.length === 0) {
    return PROVIDER_UNAVAILABLE;
  }
  const rows = p.rates.map(
    (r) => `${currencyFlag(r.code)} 1 USD = ${fmt(r.perUsd)} ${r.code}`,
  );
  return ["Курсы к доллару США:", "", ...rows, "", source(p.provider, p.asOf)].join(
    "\n",
  );
}

export function formatSource(s: RatesSource): string {
  return [
    `Источник курсов: ${s.provider}`,
    `Данные обновлены: ${dateOnly(s.asOf)}`,
  ].join("\n");
}

/** "🇪🇺 EUR" либо просто "EUR", если флага нет в справочнике. */
function withFlag(code: string): string {
  const flag = currencyFlag(code);
  return flag ? `${flag} ${code}` : code;
}

function source(provider: string, asOf: Date): string {
  return `Источник: ${provider} · ${dateOnly(asOf)}`;
}

/** 6 значащих цифр, без хвостовых нулей. */
function fmt(n: number): string {
  return Number(n.toPrecision(6)).toString();
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
