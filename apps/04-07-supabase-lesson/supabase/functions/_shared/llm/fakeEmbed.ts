// Подменные эмбеддинги для тестов (S10): без сети, один и тот же текст — всегда один и тот же вектор.
// Как fakeLlm: сервис получает Embedder параметром и о подмене не знает. Задержки и сбои тест добавляет
// обёрткой над fakeEmbed (см. knowledge.integration.test.ts).
import { EMBED_DIMENSIONS, normalizeVector } from "./embeddings.ts";
import type { Embedder } from "./types.ts";

/**
 * «Мешок слов»: каждое слово хэшируется в координату, вектор — сумма. Тексты с общими словами получаются
 * похожими по косинусу, без общих — почти ортогональными. Смысла модель не понимает, но для проверок
 * «нашёлся нужный источник» и «порог отсёк мусор» этого хватает. Пустой текст — единичный вектор по оси 0,
 * чтобы норма не была нулевой.
 */
export function fakeVector(text: string): number[] {
  const vector = new Array<number>(EMBED_DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) vector[hash(word) % EMBED_DIMENSIONS] += 1;
  if (words.length === 0) vector[0] = 1;
  return normalizeVector(vector);
}

/** FNV-1a: короткий детерминированный хэш строки. Криптостойкость не нужна. */
function hash(word: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Embedder для тестов: taskType и таймаут игнорирует. async — чтобы вести себя как настоящий (Promise). */
// deno-lint-ignore require-await
export const fakeEmbed: Embedder = async (texts) => texts.map(fakeVector);
