import {
  RateNotAvailableError,
  UnknownCurrencyError,
} from "../../domain/errors.js";
import { parseCurrencyQuery } from "../parsing/parseCurrencyQuery.js";
import type { Messenger } from "../ports/Messenger.js";
import type { RatesProvider } from "../ports/RatesProvider.js";
import {
  HELP_TEXT,
  NO_CODE_FOUND,
  PROVIDER_UNAVAILABLE,
  USD_IS_BASE,
  formatConversion,
  formatPopularRates,
  formatRateAgainstUsd,
  formatSource,
  rateNotAvailable,
  unknownCurrency,
} from "../replyText.js";
import { convertCurrency } from "./convertCurrency.js";
import { getPopularRates } from "./getPopularRates.js";
import { getRateAgainstUsd } from "./getRateAgainstUsd.js";
import { getRatesSource } from "./getRatesSource.js";

export interface IncomingMessage {
  chatId: number;
  text: string;
  /**
   * Тип чата Telegram: "private" | "group" | "supergroup" | "channel".
   * Не задан (тесты, старые вызовы) — считаем личкой.
   */
  chatType?: string;
}

export interface HandlerDeps {
  provider: RatesProvider;
  messenger: Messenger;
  /** Логгер для ошибок, которые пользователю показывать не нужно. */
  logError?: (err: unknown) => void;
}

/**
 * Главный сценарий: разобрать входящее сообщение и ответить.
 * Роутинг:
 *   /start, /help        -> справка
 *   /rates               -> курсы популярных валют к USD
 *   /source              -> активный провайдер и дата данных
 *   1 валюта             -> курс к USD (+ сумма, если указана)
 *   2 валюты             -> кросс-курс / конвертация суммы
 *   нет валют            -> подсказка
 */
export async function handleIncomingMessage(
  msg: IncomingMessage,
  deps: HandlerDeps,
): Promise<void> {
  const text = msg.text.trim();
  const command = parseCommand(text);

  // В группах отвечаем только на явные слэш-команды. Свободный текст
  // («на реал не хватает», «в 2024 EUR подорожал») там разбирать нельзя —
  // бот спамил бы курсы в ответ на обычные сообщения. Личка — без ограничений.
  const isPrivate = !msg.chatType || msg.chatType === "private";
  if (!isPrivate && command === null) {
    return;
  }

  if (command === "start" || command === "help") {
    await deps.messenger.sendMessage(msg.chatId, HELP_TEXT);
    return;
  }

  try {
    if (command === "rates") {
      const reply = formatPopularRates(await getPopularRates(deps.provider));
      await deps.messenger.sendMessage(msg.chatId, reply);
      return;
    }

    if (command === "source") {
      const reply = formatSource(await getRatesSource(deps.provider));
      await deps.messenger.sendMessage(msg.chatId, reply);
      return;
    }

    const { amount, codes } = parseCurrencyQuery(text);

    if (codes.length === 0) {
      await deps.messenger.sendMessage(msg.chatId, NO_CODE_FOUND);
      return;
    }

    // Одна валюта и это сам USD — считать нечего.
    if (codes.length === 1 && codes[0]?.toUpperCase() === "USD") {
      await deps.messenger.sendMessage(msg.chatId, USD_IS_BASE);
      return;
    }

    const reply =
      codes.length === 1
        ? formatRateAgainstUsd(
            await getRateAgainstUsd(codes[0]!, deps.provider, amount),
          )
        : formatConversion(
            await convertCurrency(codes[0]!, codes[1]!, deps.provider, amount),
          );
    await deps.messenger.sendMessage(msg.chatId, reply);
  } catch (err) {
    if (err instanceof UnknownCurrencyError) {
      await deps.messenger.sendMessage(msg.chatId, unknownCurrency(err.code));
      return;
    }
    if (err instanceof RateNotAvailableError) {
      await deps.messenger.sendMessage(
        msg.chatId,
        rateNotAvailable(err.code, err.provider),
      );
      return;
    }
    // Сеть / провайдер / неожиданный ответ API — пользователю нейтральный текст,
    // подробности в лог.
    deps.logError?.(err);
    await deps.messenger.sendMessage(msg.chatId, PROVIDER_UNAVAILABLE);
  }
}

/**
 * Достаёт имя команды из "/rates", "/rates@my_bot arg" -> "rates".
 * Возвращает null, если сообщение не начинается со слэш-команды.
 */
function parseCommand(text: string): string | null {
  const match = /^\/([a-z_]+)(?:@\w+)?\b/i.exec(text);
  return match ? match[1]!.toLowerCase() : null;
}
