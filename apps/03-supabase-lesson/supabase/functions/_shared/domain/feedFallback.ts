import type { NewsRow } from "../types.ts";

/** /сплетни: пусто у своего лагеря → показываем филлер, чтобы не было пустой листалки. */
export function resolveGossipFeed(
  campNews: readonly NewsRow[],
  fillerNews: readonly NewsRow[],
): { items: readonly NewsRow[]; usedFallback: boolean } {
  if (campNews.length > 0) return { items: campNews, usedFallback: false };
  return { items: fillerNews, usedFallback: true };
}
