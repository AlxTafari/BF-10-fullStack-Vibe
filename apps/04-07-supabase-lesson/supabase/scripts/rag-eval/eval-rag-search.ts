// Проверка векторного поиска S10 на мок-базе Лавраки: документы + блюда → фрагменты → эмбеддинги Gemini → косинус.
// Без БД: всё в памяти, чтобы до появления таблиц проверить решения §4.1 (модель, 768), §4.4 (только вектор),
// §4.6 (нарезка по структуре) и подобрать порог «не знаю» по вопросам без ответа.
//
// Запуск вручную, не в CI (настоящие вызовы Gemini, копейки за прогон):
//   pnpm eval:rag            — все вопросы, по каждому топ-3
//   pnpm eval:rag --fails    — печатать только промахи
// Нужен в .env: GEMINI_API_KEY.
//
// Нарезка здесь — черновик: в S10 переедет в domain и будет импортироваться отсюда.

interface Doc { id: string; type: string; title: string; body: string; dishes?: string[] }
interface Dish {
  id: string; category: string; name: string; description: string | null; ingredients: string | null;
  published: boolean; available: boolean;
}
interface Question { q: string; kind: string; expect: string[] }
interface Chunk { source: string; text: string }

const MODEL = "gemini-embedding-001";
const DIM = 768;
const MAX_CHUNK_CHARS = 2400; // ≈ 600–800 токенов русского текста; ориентир §4.6, подстраивается
const BATCH = 100; // предел batchEmbedContents

const dir = new URL("./", import.meta.url);
const readJson = async <T>(name: string): Promise<T> => JSON.parse(await Deno.readTextFile(new URL(name, dir)));

const { documents } = await readJson<{ documents: Doc[] }>("documents.json");
const { dishes } = await readJson<{ dishes: Dish[] }>("dishes.json");
const { questions } = await readJson<{ questions: Question[] }>("questions.json");
const onlyFails = Deno.args.includes("--fails");

const key = Deno.env.get("GEMINI_API_KEY");
if (!key) throw new Error("GEMINI_API_KEY не задан в .env");

// ---------------------------------------------------------------- нарезка (§4.6, вариант 2)

/**
 * Разделы по `## `; без заголовков — по абзацам. Мелкие соседние куски склеиваются до MAX_CHUNK_CHARS,
 * перекрытия нет. В каждый фрагмент — название документа, иначе «Только по пятницам, с 21:00» теряет тему.
 */
export function chunkDocument(doc: Doc): string[] {
  const hasHeadings = /^## /m.test(doc.body);
  const parts = (hasHeadings ? doc.body.split(/^(?=## )/m) : doc.body.split(/\n\s*\n/))
    .map((p) => p.replace(/^## /, "").trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && current.length + part.length + 2 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = part;
    } else {
      current = current ? `${current}\n\n${part}` : part;
    }
  }
  if (current) chunks.push(current);
  // Документ короткий — склейка вернёт его целиком одним фрагментом.
  return chunks.map((c) => `${doc.title}. ${c}`);
}

/** Блюдо — один фрагмент. Аллергенов в тексте нет: вектор не понимает «без молока» (решение §2.А). */
function dishText(d: Dish): string {
  return [`${d.name}. ${d.category}.`, d.description, d.ingredients ? `Состав: ${d.ingredients}.` : null]
    .filter(Boolean)
    .join(" ");
}

const chunks: Chunk[] = [
  ...documents.flatMap((doc) => chunkDocument(doc).map((text) => ({ source: `doc:${doc.id}`, text }))),
  // Неопубликованные не индексируются; стоп-лист индексируется (флаг отдаётся в момент поиска).
  ...dishes.filter((d) => d.published).map((d) => ({ source: `dish:${d.id}`, text: dishText(d) })),
];

// ---------------------------------------------------------------- эмбеддинги

const normalize = (v: number[]) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0); // векторы нормализованы

async function embed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key! },
      body: JSON.stringify({
        requests: texts.slice(i, i + BATCH).map((text) => ({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: DIM,
        })),
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const json = await res.json() as { embeddings: { values: number[] }[] };
    // Урезанный (< 3072) вектор Gemini не нормализован — без этого косинус через скалярное произведение врёт.
    out.push(...json.embeddings.map((e) => normalize(e.values)));
  }
  return out;
}

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
  `${MODEL}, ${DIM}. ✓ — правильный на 1-м месте, ~ — в топ-3, ✗ — мимо, · — вопрос без ответа.`);

let n = 0, top1 = 0, top3 = 0;
for (const [kind, s] of byKind) {
  if (kind === "нет_ответа") continue;
  n += s.n; top1 += s.top1; top3 += s.top3;
  console.log(`  ${kind.padEnd(10)} топ-1 ${s.top1}/${s.n}, топ-3 ${s.top3}/${s.n}`);
}
console.log(`  ВСЕГО      топ-1 ${top1}/${n}, топ-3 ${top3}/${n}`);

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
