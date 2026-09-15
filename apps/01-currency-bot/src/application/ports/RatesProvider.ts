import type { CurrencyCode } from "../../domain/currencyCode.js";

/**
 * Снимок курсов на момент времени.
 * rates[X] = сколько единиц X за 1 единицу base.
 */
export interface RateSnapshot {
  /** Базовая валюта, к которой выражены все курсы. У наших провайдеров — USD. */
  base: CurrencyCode;
  rates: Readonly<Record<string, number>>;
  /** Когда провайдер обновил данные, epoch ms. */
  timestamp: number;
  /** Человекочитаемое имя источника (попадает в ответ пользователю). */
  providerName: string;
}

/**
 * Порт: откуда берём курсы. Реализации — в adapters/rates.
 * Use case'ы зависят только от этого интерфейса, не от конкретного HTTP-клиента.
 */
export interface RatesProvider {
  readonly name: string;
  getSnapshot(): Promise<RateSnapshot>;
}
