// Проверка векторного поиска S10 на мок-базе Лавраки: вопросы из questions.json → топ источников → попадание.
// Два режима с одинаковыми правилами (§4.8: лучший фрагмент на источник, порог 0.60, до 5 источников):
//   в памяти (по умолчанию) — документы + блюда → фрагменты → эмбеддинги Gemini → косинус, ранжирование
//     domain/knowledgeSearch.ts. Быстрая проверка нарезки, модели и порога, БД не нужна;
//   --db — тот же набор через сервис searchKnowledge и настоящий RPC match_knowledge на seed-базе из .env
//     (после pnpm index:seed). Проверка в памяти не заменяет --db при приёмке.
//
// Запуск вручную, не в CI (настоящие вызовы Gemini, копейки за прогон):
//   pnpm eval:rag                 — все вопросы, по каждому топ-3
//   pnpm eval:rag --fails         — печатать только промахи
//   pnpm eval:rag --db [--fails]  — через БД
// Нужен в .env: GEMINI_API_KEY; для --db ещё SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.
//
// Нарезка и эмбеддинги — те же, что у индексатора (S10, сессия 2): domain/knowledgeChunks.ts и адаптер Gemini
// из _shared/llm. Иначе результат eval ничего не говорит о боевом поиске.
import { chunkDocument, dishEmbeddingText } from "../../functions/_shared/domain/knowledgeChunks.ts";
import {
  KNOWLEDGE_SEARCH_LIMIT,
  KNOWLEDGE_SEARCH_THRESHOLD,
  rankKnowledge,
  type ScoredChunk,
} from "../../functions/_shared/domain/knowledgeSearch.ts";
import { EMBED_DIMENSIONS, EMBED_MODEL } from "../../functions/_shared/llm/embeddings.ts";
import { createGeminiEmbedder } from "../../functions/_shared/llm/gemini.ts";
import { searchKnowledge } from "../../functions/_shared/services/knowledgeSearch.ts";
import { createServiceClient } from "../../functions/_shared/supabaseClient.ts";
import { RESTAURANT_ID, seedUuid } from "./seed-ids.ts";

interface Doc { id: string; type: string; title: string; body: string; dishes?: string[] }
interface Dish {
  id: string; category: string; name: string; description: string | null; ingredients: string | null;
  published: boolean; available: boolean;
}
interface Question { q: string; kind: string; expect: string[] }
/** Источник в выдаче: ключ как в questions.json («doc:history», «dish:shrimp») и балл лучшего фрагмента. */
interface Hit { source: string; score: number }

const dir = new URL("./", import.meta.url);
const readJson = async <T>(name: string): Promise<T> => JSON.parse(await Deno.readTextFile(new URL(name, dir)));

const { documents } = await readJson<{ documents: Doc[] }>("documents.json");
const { dishes } = await readJson<{ dishes: Dish[] }>("dishes.json");
const { questions } = await readJson<{ questions: Question[] }>("questions.json");
const onlyFails = Deno.args.includes("--fails");
const viaDb = Deno.args.includes("--db");

const key = Deno.env.get("GEMINI_API_KEY");
if (!key) throw new Error("GEMINI_API_KEY не задан в .env");

// Адаптер сам нормализует векторы (урезанный вектор Gemini не нормализован) и делит тексты на пачки по 10.
const embedder = createGeminiEmbedder(key);

// ---------------------------------------------------------------- режим «в памяти»

/**
 * Все фрагменты мок-базы с эмбеддингами. Неопубликованные блюда не индексируются; стоп-лист индексируется
 * (флаг отдаётся в момент поиска). Возвращает ранжирование вопроса: выдачу по боевым правилам и полный список
 * источников без порога — для статистики порога.
 */
async function inMemoryRanker() {
  const chunks = [
    ...documents.flatMap((doc) =>
      chunkDocument(doc).map((text, chunkIndex) => ({ source: "document" as const, id: doc.id, chunkIndex, text }))
    ),
    ...dishes.filter((d) => d.published).map((d) => ({
      source: "dish" as const,
      id: d.id,
      chunkIndex: 0,
      text: dishEmbeddingText({ name: d.name, categoryName: d.category, description: d.description, ingredients: d.ingredients }),
    })),
  ];
  // Таймаут с запасом: прогон ручной, торопиться некуда.
  const vectors = await embedder(chunks.map((c) => c.text), "RETRIEVAL_DOCUMENT", { timeoutMs: 60_000 });
  const docChunks = chunks.filter((c) => c.source === "document").length;
  console.log(`Индекс в памяти: ${documents.length} документов → ${docChunks} фрагментов, ${chunks.length - docChunks} блюд.`);

  const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0); // векторы нормализованы
  const toHit = (c: ScoredChunk): Hit => ({ source: `${c.source === "document" ? "doc" : "dish"}:${c.id}`, score: c.score });

  return (queryVector: number[]) => {
    const scored = chunks.map((c, i) => ({ source: c.source, id: c.id, chunkIndex: c.chunkIndex, score: cosine(queryVector, vectors[i]) }));
    return {
      results: rankKnowledge(scored).map(toHit),
      all: rankKnowledge(scored, -1, Number.MAX_SAFE_INTEGER).map(toHit),
    };
  };
}

// ---------------------------------------------------------------- режим --db

/** uuid из seed → ключ мок-базы: generate-seed раздаёт uuid по позиции в JSON. */
const sourceByUuid = new Map<string, string>([
  ...documents.map((d, i): [string, string] => [seedUuid("d", i + 1), `doc:${d.id}`]),
  ...dishes.map((d, i): [string, string] => [seedUuid("c", i + 1), `dish:${d.id}`]),
]);

async function searchDb(query: string): Promise<Hit[]> {
  const client = createServiceClient();
  const found = await searchKnowledge(
    { client, embed: embedder },
    // Крайний срок с запасом: сервис сам ограничит поиск SEARCH_TIMEOUT_MS, как в боевом ходе.
    { restaurantId: RESTAURANT_ID, query, deadline: Date.now() + 60_000 },
  );
  if (!found.ok) throw new Error(`searchKnowledge: ${found.reason} — проверь .env и pnpm index:seed`);
  return found.results.map((r) => ({ source: sourceByUuid.get(r.id) ?? `?:${r.id}`, score: r.score }));
}

// ---------------------------------------------------------------- оценка

const rankInMemory = viaDb ? null : await inMemoryRanker();
const questionVecs = viaDb ? [] : await embedder(questions.map((q) => q.q), "RETRIEVAL_QUERY", { timeoutMs: 60_000 });

const byKind = new Map<string, { n: number; top1: number; top3: number }>();
const positiveScores: number[] = [];
const negativeTop1: number[] = [];
/** Вопросы без ответа, у которых выдача по боевым правилам не пуста: модели придётся самой решить «ответа нет». */
let negativeWithResults = 0;

for (const [i, q] of questions.entries()) {
  let results: Hit[];
  let all: Hit[];
  if (rankInMemory) {
    ({ results, all } = rankInMemory(questionVecs[i]));
  } else {
    // В БД видна только выдача (порог и лимит уже применены): статистика порога — по ней.
    results = await searchDb(q.q);
    all = results;
  }
  const top3 = results.slice(0, 3);
  const stat = byKind.get(q.kind) ?? { n: 0, top1: 0, top3: 0 };
  stat.n++;

  let mark: string;
  if (q.expect.length === 0) {
    if (all.length > 0) negativeTop1.push(all[0].score);
    if (results.length > 0) negativeWithResults++;
    mark = "·";
  } else {
    // Порог считаем по баллу правильного источника, а не просто первого: важно, проходит ли нужный фрагмент.
    const hit = all.find((r) => q.expect.includes(r.source));
    if (hit) positiveScores.push(hit.score);
    const ok1 = results.length > 0 && q.expect.includes(results[0].source);
    const ok3 = top3.some((r) => q.expect.includes(r.source));
    if (ok1) stat.top1++;
    if (ok3) stat.top3++;
    mark = ok1 ? "✓" : ok3 ? "~" : "✗";
  }
  byKind.set(q.kind, stat);

  if (!onlyFails || mark === "✗" || mark === "~") {
    const shown = top3.length ? top3.map((r) => `${r.source} ${r.score.toFixed(3)}`).join(" | ") : "(ничего выше порога)";
    console.log(`${mark} [${q.kind}] ${q.q}\n    ${shown}`);
  }
}

console.log(`\nРежим: ${viaDb ? "БД (searchKnowledge → match_knowledge)" : "в памяти"}; ${EMBED_MODEL}, ${EMBED_DIMENSIONS}; ` +
  `порог ${KNOWLEDGE_SEARCH_THRESHOLD}, до ${KNOWLEDGE_SEARCH_LIMIT} источников. ` +
  `✓ — правильный на 1-м месте, ~ — в топ-3, ✗ — мимо, · — вопрос без ответа.`);

let n = 0, top1 = 0, top3 = 0;
for (const [kind, s] of byKind) {
  if (kind === "нет_ответа") continue;
  n += s.n; top1 += s.top1; top3 += s.top3;
  console.log(`  ${kind.padEnd(10)} топ-1 ${s.top1}/${s.n}, топ-3 ${s.top3}/${s.n}`);
}
console.log(`  ВСЕГО      топ-1 ${top1}/${n}, топ-3 ${top3}/${n}`);
// Критерий S10 (§5 п.18): топ-3 не ниже 34/35 при пороге 0.60 — исходный прогон на черновой нарезке дал 35/35.
console.log(top3 >= n - 1 ? `  Критерий топ-3 ≥ ${n - 1}/${n}: пройден` : `  Критерий топ-3 ≥ ${n - 1}/${n}: НЕ пройден`);

// Порог «не знаю»: где кончаются вопросы без ответа и начинаются вопросы с ответом.
const fmt = (xs: number[]) => xs.length ? `${Math.min(...xs).toFixed(3)}–${Math.max(...xs).toFixed(3)}` : "—";
const sortedPos = [...positiveScores].sort((a, b) => a - b);
console.log(`\nБалл правильного источника (вопросы с ответом): ${fmt(positiveScores)}; ` +
  `5 самых низких: ${sortedPos.slice(0, 5).map((x) => x.toFixed(3)).join(", ")}`);
const negatives = questions.filter((q) => q.expect.length === 0).length;
console.log(`Балл 1-го места (вопросы без ответа): ${fmt(negativeTop1)}; ` +
  `с выдачей выше порога: ${negativeWithResults} из ${negatives}`);
if (!viaDb && positiveScores.length && negativeTop1.length) {
  const gap = Math.min(...positiveScores) - Math.max(...negativeTop1);
  console.log(gap > 0
    ? `Зазор ${gap.toFixed(3)}: порог можно ставить между ${Math.max(...negativeTop1).toFixed(3)} и ${Math.min(...positiveScores).toFixed(3)}.`
    : `Зазора нет (пересечение ${(-gap).toFixed(3)}): чистого порога нет, часть вопросов с ответом окажется ниже вопросов без ответа.`);
}
