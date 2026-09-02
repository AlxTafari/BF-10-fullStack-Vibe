import { UnknownCurrencyError } from "../../domain/errors.js";
import { extractCurrencyCodes } from "../parsing/extractCurrencyCodes.js";
import type { Messenger } from "../ports/Messenger.js";
import type { RatesProvider } from "../ports/RatesProvider.js";
import {
  HELP_TEXT,
  NO_CODE_FOUND,
  PROVIDER_UNAVAILABLE,
  formatConversion,
  formatRateAgainstUsd,
  unknownCurrency,
} from "../replyText.js";
import { convertCurrency } from "./convertCurrency.js";
import { getRateAgainstUsd } from "./getRateAgainstUsd.js";

export interface IncomingMessage {
  chatId: number;
  text: string;
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
 *   1 код валюты         -> курс к USD
 *   2 кода валюты        -> кросс-курс первой ко второй
 *   нет кодов            -> подсказка
 */
export async function handleIncomingMessage(
  msg: IncomingMessage,
  deps: HandlerDeps,
): Promise<void> {
  const text = msg.text.trim();

  if (/^\/(start|help)\b/i.test(text)) {
    await deps.messenger.sendMessage(msg.chatId, HELP_TEXT);
    return;
  }

  const codes = extractCurrencyCodes(text);
  if (codes.length === 0) {
    await deps.messenger.sendMessage(msg.chatId, NO_CODE_FOUND);
    return;
  }

  try {
    const reply =
      codes.length === 1
        ? formatRateAgainstUsd(
            await getRateAgainstUsd(codes[0]!, deps.provider),
          )
        : formatConversion(
            await convertCurrency(codes[0]!, codes[1]!, deps.provider),
          );
    await deps.messenger.sendMessage(msg.chatId, reply);
  } catch (err) {
    if (err instanceof UnknownCurrencyError) {
      await deps.messenger.sendMessage(msg.chatId, unknownCurrency(err.code));
      return;
    }
    // Сеть / провайдер / неожиданный ответ API — пользователю нейтральный текст,
    // подробности в лог.
    deps.logError?.(err);
    await deps.messenger.sendMessage(msg.chatId, PROVIDER_UNAVAILABLE);
  }
}
