/**
 * Доменные ошибки. Слой application/adapters ловит их по типу
 * и решает, что показать пользователю.
 */

/** Код валюты не входит в наш список поддерживаемых. */
export class UnknownCurrencyError extends Error {
  constructor(public readonly code: string) {
    super(`Unknown currency code: ${code}`);
    this.name = "UnknownCurrencyError";
  }
}

/** Провайдер курсов недоступен / вернул неожиданный ответ. */
export class RatesProviderError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown,
  ) {
    super(message);
    this.name = "RatesProviderError";
  }
}
