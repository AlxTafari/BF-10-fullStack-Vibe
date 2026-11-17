// Проверка векторного поиска S10 на мок-базе Лавраки: документы + блюда → фрагменты → эмбеддинги Gemini → косинус.
// Без БД: всё в памяти — проверка решений §4.1 (модель, 768), §4.4 (только вектор), §4.7 (нарезка по структуре)
// и порога «не знаю» по вопросам без ответа.
//
// Запуск вручную, не в CI (настоящие вызовы Gemini, копейки за прогон):
//   pnpm eval:rag            — все вопросы, по каждому топ-3
//   pnpm eval:rag --fails    — печатать только промахи
// Нужен в .env: GEMINI_API_KEY.
//
// Нарезка и эмбеддинги — те же, что у индексатора (S10, сессия 2): domain/knowledgeChunks.ts и адаптер Gemini
// из _shared/llm. Иначе результат eval ничего не говорит о боевом поиске.
import { chunkDocument, dishEmbeddingText } from "../../functions/_shared/domain/knowledgeChunks.ts";
import { EMBED_DIMENSIONS, EMBED_MODEL } from "../../functions/_shared/llm/embeddings.ts";
import { createGeminiEmbedder } from "../../functions/_shared/llm/gemini.ts";

interface Doc { id: string; type: string; title: string; body: string; dishes?: string[] }
interface Dish {
  id: string; category: string; name: string; description: string | null; ingredients: string | null;
  published: boolean; available: boolean;
}
interface Question { q: string; kind: string; expect: string[] }
interface Chunk { source: string; text: string }

const dir = new URL("./", import.meta.url);
const readJson = async <T>(name: string): Promise<T> => JSON.parse(await Deno.readTextFile(new URL(name, dir)));

const { documents } = await readJson<{ documents: Doc[] }>("documents.json");
const { dishes } = await readJson<{ dishes: Dish[] }>("dishes.json");
const { questions } = await readJson<{ questions: Question[] }>("questions.json");
const onlyFails = Deno.args.includes("--fails");

const key = Deno.env.get("GEMINI_API_KEY");
if (!key) throw new Error("GEMINI_API_KEY не задан в .env");

// ---------------------------------------------------------------- фрагменты

const chunks: Chunk[] = [
  ...documents.flatMap((doc) => chunkDocument(doc).map((text) => ({ source: `doc:${doc.id}`, text }))),
  // Неопубликованные не индексируются; стоп-лист индексируется (флаг отдаётся в момент поиска).
  ...dishes.filter((d) => d.published).map((d) => ({
    source: `dish:${d.id}`,
    text: dishEmbeddingText({ name: d.name, categoryName: d.category, description: d.description, ingredients: d.ingredients }),
  })),
];

// ---------------------------------------------------------------- эмбеддинги

// Адаптер сам нормализует векторы (урезанный вектор Gemini не нормализован) и делит тексты на пачки по 10.
// Таймаут с запасом: прогон ручной, торопиться некуда.
const embedder = createGeminiEmbedder(key);
const embed = (texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") =>
  embedder(texts, taskType, { timeoutMs: 60_000 });
const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0); // векторы нормализованы

const chunkVecs = await embed(chunks.map((c) => c.text), "RETRIEVAL_DOCUMENT");
const questionVecs = await embed(questions.map((q) => q.q), "RETRIEVAL_QUERY");

// ---------------------------------------------------------------- оценка

/** Лучший балл на источник: у документа из нескольких фрагментов в топ идёт один, самый похожий. */
function rank(qv: number[]) {
  const best = new Map<string, number>();
  chunks.forEach((c, i) => {
    const s = cosine(qv, chunkVecs[i]);
    if (s > (best.get(c.source) ?? -1)) best.set(c.source, s);
  });
  return [...best].map(([source, score]) => ({ source, score })).sort((a, b) => b.score - a.score);
}

const byKind = new Map<string, { n: number; top1: number; top3: number }>();
const positiveTop1: number[] = [];
const negativeTop1: number[] = [];

questions.forEach((q, i) => {
  const ranked = rank(questionVecs[i]);
  const top3 = ranked.slice(0, 3);
  const stat = byKind.get(q.kind) ?? { n: 0, top1: 0, top3: 0 };
  stat.n++;

  let mark: string;
  if (q.expect.length === 0) {
    negativeTop1.push(ranked[0].score);
    mark = "·";
  } else {
    // Порог считаем по баллу правильного источника, а не просто первого: важно, проходит ли нужный фрагмент.
    const hit = ranked.find((r) => q.expect.includes(r.source));
    if (hit) positiveTop1.push(hit.score);
    const ok1 = q.expect.includes(ranked[0].source);
    const ok3 = top3.some((r) => q.expect.includes(r.source));
    if (ok1) stat.top1++;
    if (ok3) stat.top3++;
    mark = ok1 ? "✓" : ok3 ? "~" : "✗";
  }
  byKind.set(q.kind, stat);

  if (!onlyFails || mark === "✗" || mark === "~") {
    console.log(`${mark} [${q.kind}] ${q.q}\n    ${top3.map((r) => `${r.source} ${r.score.toFixed(3)}`).join(" | ")}`);
  }
});

const docChunks = chunks.filter((c) => c.source.startsWith("doc:")).length;
console.log(`\nИндекс: ${documents.length} документов → ${docChunks} фрагментов, ${chunks.length - docChunks} блюд; ` +
  `${EMBED_MODEL}, ${EMBED_DIMENSIONS}. ✓ — правильный на 1-м месте, ~ — в топ-3, ✗ — мимо, · — вопрос без ответа.`);

let n = 0, top1 = 0, top3 = 0;
for (const [kind, s] of byKind) {
  if (kind === "нет_ответа") continue;
  n += s.n; top1 += s.top1; top3 += s.top3;
  console.log(`  ${kind.padEnd(10)} топ-1 ${s.top1}/${s.n}, топ-3 ${s.top3}/${s.n}`);
}
console.log(`  ВСЕГО      топ-1 ${top1}/${n}, топ-3 ${top3}/${n}`);
// Критерий S10 (сессия 2): топ-3 не ниже 34/35 — исходный прогон на черновой нарезке дал 35/35.
console.log(top3 >= n - 1 ? `  Критерий топ-3 ≥ ${n - 1}/${n}: пройден` : `  Критерий топ-3 ≥ ${n - 1}/${n}: НЕ пройден`);

// Порог «не знаю»: где кончаются вопросы без ответа и начинаются вопросы с ответом.
const fmt = (xs: number[]) => xs.length ? `${Math.min(...xs).toFixed(3)}–${Math.max(...xs).toFixed(3)}` : "—";
const sortedPos = [...positiveTop1].sort((a, b) => a - b);
console.log(`\nБалл правильного источника (вопросы с ответом): ${fmt(positiveTop1)}; ` +
  `5 самых низких: ${sortedPos.slice(0, 5).map((x) => x.toFixed(3)).join(", ")}`);
console.log(`Балл 1-го места (вопросы без ответа): ${fmt(negativeTop1)}`);
const gap = Math.min(...positiveTop1) - Math.max(...negativeTop1);
console.log(gap > 0
  ? `Зазор ${gap.toFixed(3)}: порог можно ставить между ${Math.max(...negativeTop1).toFixed(3)} и ${Math.min(...positiveTop1).toFixed(3)}.`
  : `Зазора нет (пересечение ${(-gap).toFixed(3)}): чистого порога нет, часть вопросов с ответом окажется ниже вопросов без ответа.`);
