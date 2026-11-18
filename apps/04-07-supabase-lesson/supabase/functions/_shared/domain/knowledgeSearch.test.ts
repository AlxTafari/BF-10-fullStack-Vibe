import { assertEquals } from "@std/assert";
import { rankKnowledge, type ScoredChunk } from "./knowledgeSearch.ts";

const doc = (id: string, chunkIndex: number, score: number): ScoredChunk => ({ source: "document", id, chunkIndex, score });
const dish = (id: string, score: number): ScoredChunk => ({ source: "dish", id, chunkIndex: 0, score });

Deno.test("rankKnowledge: один источник — один результат, его лучший фрагмент", () => {
  const ranked = rankKnowledge([doc("a", 0, 0.7), doc("a", 1, 0.9), doc("a", 2, 0.8), doc("b", 0, 0.65)], 0.6, 2);
  assertEquals(ranked, [doc("a", 1, 0.9), doc("b", 0, 0.65)]);
});

Deno.test("rankKnowledge: порог включительно, ниже — отсекается", () => {
  assertEquals(rankKnowledge([doc("a", 0, 0.6), dish("x", 0.59)], 0.6, 5), [doc("a", 0, 0.6)]);
});

Deno.test("rankKnowledge: лимит считает разные источники", () => {
  const chunks = [doc("a", 0, 0.9), doc("a", 1, 0.89), doc("a", 2, 0.88), doc("b", 0, 0.8), dish("x", 0.7)];
  assertEquals(rankKnowledge(chunks, 0.6, 2).map((c) => c.id), ["a", "b"]);
});

Deno.test("rankKnowledge: равные оценки — по source, id, chunkIndex", () => {
  const ranked = rankKnowledge([dish("b", 0.7), doc("z", 1, 0.7), doc("z", 0, 0.7), doc("c", 0, 0.7)], 0.6, 5);
  // "dish" < "document" — как сравнение text в SQL; id — uuid, его порядок совпадает со строковым (нижний регистр).
  assertEquals(ranked, [dish("b", 0.7), doc("c", 0, 0.7), doc("z", 0, 0.7)]);
});

Deno.test("rankKnowledge: пустой вход — пустой результат", () => {
  assertEquals(rankKnowledge([]), []);
});
