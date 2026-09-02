import type { RatesProvider } from "../ports/RatesProvider.js";

export interface RatesSource {
  provider: string;
  /** Когда источник последний раз обновил курсы. */
  asOf: Date;
}

/**
 * Команда /source: какой провайдер сейчас активен и насколько свежие данные.
 */
export async function getRatesSource(
  provider: RatesProvider,
): Promise<RatesSource> {
  const snap = await provider.getSnapshot();
  return { provider: snap.providerName, asOf: new Date(snap.timestamp) };
}
