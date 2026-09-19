import type { NewsRow } from "../types.ts";

/** /хроника: пользовательские вести (уже посортированы по свежести) идут первыми, затем — истории терминала. */
export function buildChronicleFeed(
  userNews: readonly NewsRow[],
  fillerNews: readonly NewsRow[],
): readonly NewsRow[] {
  return [...userNews, ...fillerNews];
}
