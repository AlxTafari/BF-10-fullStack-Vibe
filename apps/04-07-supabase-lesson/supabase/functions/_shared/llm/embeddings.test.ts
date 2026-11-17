import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { checkEmbeddings, EMBED_DIMENSIONS, inBatches, normalizeVector } from "./embeddings.ts";
import { fakeVector } from "./fakeEmbed.ts";
import { LlmError } from "./types.ts";

const vec = (fill: number) => new Array<number>(EMBED_DIMENSIONS).fill(fill);
const norm = (v: number[]) => Math.hypot(...v);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

Deno.test("normalizeVector: длина 1, направление сохраняется", () => {
  const v = normalizeVector([3, 4]);
  assertAlmostEquals(v[0], 0.6);
  assertAlmostEquals(v[1], 0.8);
});

Deno.test("normalizeVector: нулевой вектор — bad_response", () => {
  const error = assertThrows(() => normalizeVector([0, 0, 0]), LlmError);
  assertEquals(error.kind, "bad_response");
});

Deno.test("checkEmbeddings: корректный ответ нормализуется", () => {
  const [v] = checkEmbeddings([vec(2)], 1);
  assertEquals(v.length, EMBED_DIMENSIONS);
  assertAlmostEquals(norm(v), 1);
});

Deno.test("checkEmbeddings: не то число векторов, не та размерность, NaN, пусто — bad_response", () => {
  const cases: [(number[] | undefined)[] | undefined, number][] = [
    [undefined, 1],
    [[vec(1)], 2],
    [[vec(1).slice(1)], 1],
    [[undefined], 1],
    [[[...vec(1).slice(1), NaN]], 1],
    [[[...vec(1).slice(1), Infinity]], 1],
    [[vec(0)], 1],
  ];
  for (const [raw, count] of cases) {
    assertEquals(assertThrows(() => checkEmbeddings(raw, count), LlmError).kind, "bad_response");
  }
});

Deno.test("inBatches: по 10, порядок сохраняется, пустой ввод — без пачек", () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  const batches = inBatches(items);
  assertEquals(batches.map((b) => b.length), [10, 10, 3]);
  assertEquals(batches.flat(), items);
  assertEquals(inBatches([]), []);
});

Deno.test("fakeVector: детерминирован, похожие тексты ближе непохожих", () => {
  assertEquals(fakeVector("мидии в томатах"), fakeVector("мидии в томатах"));
  assertAlmostEquals(norm(fakeVector("")), 1);
  const query = fakeVector("мидии в томатах с сыром");
  assertEquals(dot(query, fakeVector("мидии саганаки в томатах")) > dot(query, fakeVector("история ресторана")), true);
});
