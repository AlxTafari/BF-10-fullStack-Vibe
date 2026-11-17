// Общее для эмбеддингов (S10): константы модели и проверка ответа. Без SDK — им пользуются и адаптер Gemini
// (gemini.ts), и фейк для тестов (fakeEmbed.ts).
import { LlmError } from "./types.ts";

/**
 * Модель и размерность — константы в коде, а не секреты: размерность зашита в схему
 * (knowledge_chunks.embedding vector(768)), а векторы разных моделей несравнимы между собой.
 * Смена модели = миграция + полная переиндексация, а не правка переменной окружения.
 */
export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMENSIONS = 768;
/** Текстов в одном запросе к провайдеру; больше — делим на пачки (S10 §2, сессия 2). */
export const EMBED_BATCH_SIZE = 10;

/**
 * Длина вектора → 1. Gemini нормализует только полный вектор (3072); урезанный через outputDimensionality
 * — нет, а поиск считает косинус как скалярное произведение нормализованных векторов.
 * Нулевая норма — ошибка: такой вектор ни на что не похож, и делить на 0 нельзя.
 */
export function normalizeVector(values: number[]): number[] {
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm === 0) throw new LlmError("bad_response", "embedding has zero or non-finite norm");
  return values.map((x) => x / norm);
}

/**
 * Ответ провайдера → нормализованные векторы. Проверяем всё, что потом молча испортило бы индекс:
 * число векторов (иначе фрагмент получит чужой вектор), размерность, конечность координат, ненулевую норму.
 * Сообщение ошибки без данных ответа: только что не так.
 */
export function checkEmbeddings(raw: (number[] | undefined)[] | undefined, expectedCount: number): number[][] {
  if (!raw || raw.length !== expectedCount) {
    throw new LlmError("bad_response", `expected ${expectedCount} embeddings, got ${raw?.length ?? 0}`);
  }
  return raw.map((values) => {
    if (!values || values.length !== EMBED_DIMENSIONS) {
      throw new LlmError("bad_response", `expected ${EMBED_DIMENSIONS} dimensions, got ${values?.length ?? 0}`);
    }
    if (!values.every(Number.isFinite)) throw new LlmError("bad_response", "embedding has non-finite values");
    return normalizeVector(values);
  });
}

/** Пачки по size элементов, порядок сохраняется. */
export function inBatches<T>(items: T[], size = EMBED_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
