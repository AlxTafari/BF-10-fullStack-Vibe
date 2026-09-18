import type { NewsRow } from "../types.ts";
import { pickRandom } from "./randomPick.ts";

/** author_id есть → именное вступление с именем автора, нет → безличное (филлер и анонимки — один и тот же случай). */
export function attributeNews(
  news: NewsRow,
  author: { name: string | null } | null,
  namedIntros: readonly string[],
  impersonalIntros: readonly string[],
): string {
  if (author) {
    const intro = pickRandom(namedIntros) ?? "рассказывает";
    return `${author.name} ${intro}, ${news.text}`;
  }
  const intro = pickRandom(impersonalIntros) ?? "поговаривают, что";
  return `${intro}, ${news.text}`;
}
