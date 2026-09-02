import type { CurrencyCode } from "./currencyCode.js";

/**
 * Справочник валют: код ISO 4217 -> флаг, русское название, синонимы.
 *
 * `aliases` — как валюту могут назвать в тексте (в нижнем регистре, без учёта
 * регистра при поиске). Кладём несколько словоформ вручную: "доллар", "доллара",
 * "долларов". Морфологию не подключаем — для бота хватает списка.
 * Сам код (в любом регистре) и так распознаётся, в aliases его дублировать не надо.
 */
export interface CurrencyMeta {
  code: CurrencyCode;
  flag: string;
  nameRu: string;
  aliases: readonly string[];
}

function meta(
  code: string,
  flag: string,
  nameRu: string,
  aliases: readonly string[] = [],
): CurrencyMeta {
  return { code: code as CurrencyCode, flag, nameRu, aliases };
}

export const CURRENCIES: Readonly<Record<string, CurrencyMeta>> = {
  USD: meta("USD", "🇺🇸", "доллар США", [
    "доллар", "доллара", "долларов", "долларах", "долл", "бакс", "бакса", "баксов", "usd", "dollar",
  ]),
  EUR: meta("EUR", "🇪🇺", "евро", ["евро", "евра", "euro"]),
  GBP: meta("GBP", "🇬🇧", "фунт стерлингов", [
    "фунт", "фунта", "фунтов", "фунтах", "стерлинг", "стерлингов", "pound",
  ]),
  JPY: meta("JPY", "🇯🇵", "японская иена", [
    "иена", "иены", "иен", "иенах", "йена", "йены", "йен", "yen",
  ]),
  CHF: meta("CHF", "🇨🇭", "швейцарский франк", [
    "франк", "франка", "франков", "франках",
  ]),
  CNY: meta("CNY", "🇨🇳", "китайский юань", [
    "юань", "юаня", "юаней", "юанях", "жэньминьби", "yuan",
  ]),
  RUB: meta("RUB", "🇷🇺", "российский рубль", [
    "рубль", "рубля", "рублей", "рублях", "руб", "ruble",
  ]),
  UAH: meta("UAH", "🇺🇦", "украинская гривна", [
    "гривна", "гривны", "гривен", "гривнах", "грн", "hryvnia",
  ]),
  KZT: meta("KZT", "🇰🇿", "казахстанский тенге", ["тенге", "tenge"]),
  PLN: meta("PLN", "🇵🇱", "польский злотый", ["злотый", "злотых", "злотые", "zloty"]),
  TRY: meta("TRY", "🇹🇷", "турецкая лира", [
    "лира", "лиры", "лир", "лирах", "lira",
  ]),
  BYN: meta("BYN", "🇧🇾", "белорусский рубль", ["бел рубль", "byn"]),
  GEL: meta("GEL", "🇬🇪", "грузинский лари", ["лари", "lari"]),
  AMD: meta("AMD", "🇦🇲", "армянский драм", ["драм", "драма", "драмов"]),
  AZN: meta("AZN", "🇦🇿", "азербайджанский манат", ["манат", "маната", "манатов"]),
  CAD: meta("CAD", "🇨🇦", "канадский доллар"),
  AUD: meta("AUD", "🇦🇺", "австралийский доллар"),
  NZD: meta("NZD", "🇳🇿", "новозеландский доллар"),
  HKD: meta("HKD", "🇭🇰", "гонконгский доллар"),
  SGD: meta("SGD", "🇸🇬", "сингапурский доллар"),
  SEK: meta("SEK", "🇸🇪", "шведская крона"),
  NOK: meta("NOK", "🇳🇴", "норвежская крона"),
  DKK: meta("DKK", "🇩🇰", "датская крона"),
  CZK: meta("CZK", "🇨🇿", "чешская крона"),
  HUF: meta("HUF", "🇭🇺", "венгерский форинт"),
  RON: meta("RON", "🇷🇴", "румынский лей"),
  BGN: meta("BGN", "🇧🇬", "болгарский лев"),
  INR: meta("INR", "🇮🇳", "индийская рупия", ["рупия", "рупий"]),
  BRL: meta("BRL", "🇧🇷", "бразильский реал", ["реал", "реала"]),
  MXN: meta("MXN", "🇲🇽", "мексиканское песо", ["песо"]),
  ARS: meta("ARS", "🇦🇷", "аргентинское песо"),
  CLP: meta("CLP", "🇨🇱", "чилийское песо"),
  COP: meta("COP", "🇨🇴", "колумбийское песо"),
  ZAR: meta("ZAR", "🇿🇦", "южноафриканский рэнд", ["рэнд", "ранд"]),
  KRW: meta("KRW", "🇰🇷", "южнокорейская вона", ["вона", "воны"]),
  THB: meta("THB", "🇹🇭", "тайский бат", ["бат", "бата"]),
  IDR: meta("IDR", "🇮🇩", "индонезийская рупия"),
  MYR: meta("MYR", "🇲🇾", "малайзийский ринггит"),
  PHP: meta("PHP", "🇵🇭", "филиппинское песо"),
  VND: meta("VND", "🇻🇳", "вьетнамский донг", ["донг"]),
  ILS: meta("ILS", "🇮🇱", "израильский шекель", ["шекель", "шекеля", "шекелей"]),
  AED: meta("AED", "🇦🇪", "дирхам ОАЭ", ["дирхам", "дирхама"]),
  SAR: meta("SAR", "🇸🇦", "саудовский риял", ["риял", "риала"]),
  QAR: meta("QAR", "🇶🇦", "катарский риал"),
  EGP: meta("EGP", "🇪🇬", "египетский фунт"),
  ISK: meta("ISK", "🇮🇸", "исландская крона"),
  HRK: meta("HRK", "🇭🇷", "хорватская куна", ["куна", "куны"]),
};

/** Валюты для команды /rates (корзина популярных). */
export const POPULAR_CODES: readonly CurrencyCode[] = (
  ["EUR", "GBP", "CHF", "JPY", "CNY", "RUB", "UAH", "KZT", "TRY", "PLN"] as const
).map((c) => c as CurrencyCode);

/** Множество известных кодов (для быстрой проверки). */
export const KNOWN_CURRENCY_CODES: ReadonlySet<string> = new Set(
  Object.keys(CURRENCIES),
);

/**
 * Синоним / код (в нижнем регистре) -> код ISO.
 * Строим один раз при загрузке модуля.
 */
export const ALIAS_TO_CODE: ReadonlyMap<string, CurrencyCode> = (() => {
  const map = new Map<string, CurrencyCode>();
  for (const m of Object.values(CURRENCIES)) {
    map.set(m.code.toLowerCase(), m.code);
    for (const alias of m.aliases) {
      map.set(alias.toLowerCase(), m.code);
    }
  }
  return map;
})();

/** Все распознаваемые термины (коды + синонимы), длинные раньше коротких. */
export const RECOGNISED_TERMS: readonly string[] = [...ALIAS_TO_CODE.keys()].sort(
  (a, b) => b.length - a.length,
);

export function currencyMeta(code: CurrencyCode): CurrencyMeta | undefined {
  return CURRENCIES[code];
}

/** Флаг валюты или пустая строка, если нет в справочнике. */
export function currencyFlag(code: string): string {
  return CURRENCIES[code.toUpperCase()]?.flag ?? "";
}
