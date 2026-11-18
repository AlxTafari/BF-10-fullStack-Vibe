// Интеграционные тесты поиска по базе знаний (S10, сессия 3): сервис searchKnowledge + настоящий RPC match_knowledge.
// Запуск: deno test --allow-env --allow-net --allow-read --env-file=../../.env _shared/services/knowledgeSearch.integration.test.ts
// Без SUPABASE_URL тесты пропускаются (в CI их гоняет job integration). Каждый тест заводит свои рестораны и удаляет их.
//
// Векторы управляемые: эмбеддер по метке в тексте отдаёт заранее выбранный вектор, запрос — ось 0. Сходство
// фрагмента с запросом задаётся числом: similarTo(0.9) — вектор с косинусом 0.9 к оси 0. Так проверяются порог,
// лимит и порядок без зависимости от того, как модель «понимает» текст.
import { assert, assertEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkDocument } from "../domain/knowledgeChunks.ts";
import { KNOWLEDGE_SEARCH_LIMIT, KNOWLEDGE_SEARCH_THRESHOLD } from "../domain/knowledgeSearch.ts";
import { EMBED_DIMENSIONS } from "../llm/embeddings.ts";
import type { Embedder } from "../llm/types.ts";
import { createServiceClient } from "../supabaseClient.ts";
import { indexDish, indexDocument } from "./knowledge.ts";
import { type KnowledgeMatch, searchKnowledge } from "./knowledgeSearch.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/** Тест со своими ресторанами (count штук): удаление в finally, каскад уносит документы, блюда, связи и чанки. */
function searchTest(name: string, fn: (client: SupabaseClient, restaurants: string[]) => Promise<void>, count = 1) {
  Deno.test({
    name: `поиск по базе знаний: ${name}`,
    ignore: !enabled,
    // supabase-js держит соединения; тест сам ничего не оставляет открытым.
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const client = createServiceClient();
      const rows = Array.from({ length: count }, () => ({ name: "knowledge-search-test", currency: "EUR" }));
      const { data, error } = await client.from("restaurants").insert(rows).select("id");
      if (error) throw error;
      const ids = data.map((r: { id: string }) => r.id);
      try {
        await fn(client, ids);
      } finally {
        await client.from("restaurants").delete().in("id", ids);
      }
    },
  });
}

// ---------------------------------------------------------------- управляемые векторы

const QUERY = "вопрос-гостя";
let nextAxis = 1;

/** Нормализованный вектор с косинусом similarity к оси 0; у каждого вызова своя вторая ось — фрагменты различимы. */
function similarTo(similarity: number): number[] {
  const v = new Array<number>(EMBED_DIMENSIONS).fill(0);
  v[0] = similarity;
  v[nextAxis++ % (EMBED_DIMENSIONS - 1) + 1] = Math.sqrt(1 - similarity * similarity);
  return v;
}

/**
 * Эмбеддер по меткам: текст с меткой из table получает её вектор, текст запроса QUERY — ось 0.
 * Текст без метки — ошибка теста: значит, нарезка или запрос не те, что задумано.
 */
function labeledEmbed(table: Record<string, number[]>): Embedder {
  const axis0 = new Array<number>(EMBED_DIMENSIONS).fill(0);
  axis0[0] = 1;
  // deno-lint-ignore require-await
  return async (texts) =>
    texts.map((text) => {
      if (text === QUERY) return axis0;
      const label = Object.keys(table).find((l) => text.includes(l));
      if (!label) throw new Error(`labeledEmbed: в тексте нет метки: ${text.slice(0, 60)}`);
      return table[label];
    });
}

// ---------------------------------------------------------------- данные

async function addDocument(
  client: SupabaseClient,
  restaurantId: string,
  doc: { title: string; body: string; type?: string; published?: boolean },
): Promise<string> {
  const { data, error } = await client.from("knowledge_documents").insert({
    restaurant_id: restaurantId,
    title: doc.title,
    body: doc.body,
    type: doc.type ?? "other",
    is_published: doc.published ?? true,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function addDish(
  client: SupabaseClient,
  restaurantId: string,
  dish: { name: string; price: number; available?: boolean; published?: boolean },
): Promise<string> {
  const { data, error } = await client.from("menu_items").insert({
    restaurant_id: restaurantId,
    name: dish.name,
    price: dish.price,
    is_available: dish.available ?? true,
    is_published: dish.published ?? true,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function link(client: SupabaseClient, restaurantId: string, documentId: string, dishIds: string[]) {
  const rows = dishIds.map((id, i) => ({ document_id: documentId, menu_item_id: id, restaurant_id: restaurantId, sort_order: i }));
  const { error } = await client.from("knowledge_document_dishes").insert(rows);
  if (error) throw error;
}

async function update(client: SupabaseClient, table: "knowledge_documents" | "menu_items", id: string, patch: Record<string, unknown>) {
  const { error } = await client.from(table).update(patch).eq("id", id);
  if (error) throw error;
}

async function search(client: SupabaseClient, embed: Embedder, restaurantId: string): Promise<KnowledgeMatch[]> {
  const found = await searchKnowledge({ client, embed }, { restaurantId, query: QUERY, deadline: Date.now() + 60_000 });
  if (!found.ok) throw new Error(`searchKnowledge: ${found.reason}`);
  return found.results;
}

const ids = (results: KnowledgeMatch[]) => results.map((r) => r.id);

/** Документ из трёх разделов по ~1500 символов — нарезка даёт три фрагмента; метка раздела — в его тексте. */
function threeSections(labels: [string, string, string]): string {
  return labels.map((label, n) => `## Раздел ${n + 1}\n\n${label}. ` + "Подробный факт о ресторане. ".repeat(55)).join("\n\n");
}

// ---------------------------------------------------------------- тесты

searchTest("лимит — разные источники: фрагменты одного документа не занимают его целиком", async (client, [r]) => {
  const body = threeSections(["метка-раздел-1", "метка-раздел-2", "метка-раздел-3"]);
  assertEquals(chunkDocument({ title: "Большой", body }).length, 3, "тестовый документ должен давать три фрагмента");
  const table: Record<string, number[]> = {
    // Лучший — второй раздел: в выдаче его текст, а не первого фрагмента.
    "метка-раздел-1": similarTo(0.93),
    "метка-раздел-2": similarTo(0.95),
    "метка-раздел-3": similarTo(0.94),
  };
  const embed = labeledEmbed(table);
  const big = await addDocument(client, r, { title: "Большой", body });
  await indexDocument({ client, embed }, big);

  const small: string[] = [];
  for (let i = 1; i <= KNOWLEDGE_SEARCH_LIMIT; i++) {
    table[`метка-малый-${i}`] = similarTo(0.9 - i * 0.02);
    const id = await addDocument(client, r, { title: `Малый ${i}`, body: `метка-малый-${i}` });
    await indexDocument({ client, embed }, id);
    small.push(id);
  }

  const results = await search(client, embed, r);
  assertEquals(results.length, KNOWLEDGE_SEARCH_LIMIT);
  assertEquals(ids(results), [big, ...small.slice(0, KNOWLEDGE_SEARCH_LIMIT - 1)]);
  const first = results[0];
  assert(first.source === "document");
  assert(first.content.includes("метка-раздел-2"), "в выдаче не лучший фрагмент документа");
  assert(Math.abs(first.score - 0.95) < 1e-4, `балл ${first.score}`);
});

searchTest("порог: ниже — нет в выдаче; ничего выше порога — пустой результат", async (client, [r]) => {
  const embed = labeledEmbed({
    "метка-выше": similarTo(KNOWLEDGE_SEARCH_THRESHOLD + 0.01),
    "метка-ниже": similarTo(KNOWLEDGE_SEARCH_THRESHOLD - 0.01),
  });
  const above = await addDocument(client, r, { title: "Выше", body: "метка-выше" });
  const below = await addDocument(client, r, { title: "Ниже", body: "метка-ниже" });
  await indexDocument({ client, embed }, above);
  await indexDocument({ client, embed }, below);
  assertEquals(ids(await search(client, embed, r)), [above]);

  await update(client, "knowledge_documents", above, { is_published: false });
  assertEquals(await search(client, embed, r), []);
});

searchTest("актуальность: после правки старые чанки не ищутся, после индексации — новая редакция", async (client, [r]) => {
  const embed = labeledEmbed({ "метка-старая": similarTo(0.9), "метка-новая": similarTo(0.8) });
  const id = await addDocument(client, r, { title: "Живая музыка", body: "метка-старая: по пятницам" });
  await indexDocument({ client, embed }, id);
  assertEquals(ids(await search(client, embed, r)), [id]);

  // Правка мимо индексатора: чанки старой редакции на месте, но версия источника ушла вперёд.
  await update(client, "knowledge_documents", id, { body: "метка-новая: по субботам" });
  assertEquals(await search(client, embed, r), []);

  await indexDocument({ client, embed }, id);
  const [hit] = await search(client, embed, r);
  assert(hit?.source === "document" && hit.content.includes("по субботам"), "в выдаче не новая редакция");
});

searchTest("публикация: неопубликованные документ и блюдо не ищутся", async (client, [r]) => {
  const embed = labeledEmbed({ "метка-документ": similarTo(0.9), "Блюдо-метка": similarTo(0.85) });
  const doc = await addDocument(client, r, { title: "Док", body: "метка-документ" });
  const dish = await addDish(client, r, { name: "Блюдо-метка", price: 10 });
  await indexDocument({ client, embed }, doc);
  await indexDish({ client, embed }, dish);
  assertEquals(ids(await search(client, embed, r)), [doc, dish]);

  // Снятие с публикации удаляет чанки триггером, без индексатора.
  await update(client, "knowledge_documents", doc, { is_published: false });
  await update(client, "menu_items", dish, { is_published: false });
  assertEquals(await search(client, embed, r), []);
});

searchTest("блюдо: цена и стоп-лист — текущие из таблицы, без переиндексации", async (client, [r]) => {
  const embed = labeledEmbed({ "Креветки-метка": similarTo(0.9) });
  const dish = await addDish(client, r, { name: "Креветки-метка", price: 18 });
  await indexDish({ client, embed }, dish);
  await update(client, "menu_items", dish, { price: 21.5, is_available: false });

  const results = await search(client, embed, r);
  assertEquals(results.length, 1);
  // Балл проверяют другие тесты; здесь — поля блюда.
  assertEquals({ ...results[0], score: 0 }, {
    source: "dish",
    id: dish,
    score: 0,
    name: "Креветки-метка",
    price: 21.5,
    currency: "EUR",
    available: false,
  });
});

searchTest("подборка: состав — опубликованные блюда из связей в порядке sort_order, текущие поля", async (client, [r]) => {
  const embed = labeledEmbed({ "метка-подборка": similarTo(0.9) });
  const sardines = await addDish(client, r, { name: "Сардины", price: 9 });
  const mussels = await addDish(client, r, { name: "Мидии", price: 14 });
  const hidden = await addDish(client, r, { name: "Скрытое", price: 5, published: false });
  // Упомянуто в тексте, но не в связях — в dishes его нет.
  const mentioned = await addDish(client, r, { name: "Упомянутое", price: 7 });
  const doc = await addDocument(client, r, { title: "Лёгкое", body: "метка-подборка. Упомянутое тоже хорошо", type: "collection" });
  await link(client, r, doc, [mussels, hidden, sardines]);
  await indexDocument({ client, embed }, doc);
  // Блюда подборки не индексированы (pending): устаревший или отсутствующий вектор блюда состав не скрывает.

  const dishesOf = async () => {
    const [hit] = await search(client, embed, r);
    assert(hit?.source === "document");
    return hit.dishes;
  };
  assertEquals(await dishesOf(), [
    { id: mussels, name: "Мидии", price: 14, currency: "EUR", available: true },
    { id: sardines, name: "Сардины", price: 9, currency: "EUR", available: true },
  ]);
  assert(!(await dishesOf()).some((d) => d.id === mentioned || d.id === hidden));

  // Цена, стоп-лист и связи меняются без Gemini: следующий поиск видит их сразу.
  await update(client, "menu_items", sardines, { price: 10, is_available: false });
  await client.from("knowledge_document_dishes").delete().eq("document_id", doc).eq("menu_item_id", mussels);
  assertEquals(await dishesOf(), [{ id: sardines, name: "Сардины", price: 10, currency: "EUR", available: false }]);

  // Снятое с публикации блюдо исчезает из состава; пустая подборка — пустой dishes, документ находится.
  await update(client, "menu_items", sardines, { is_published: false });
  assertEquals(await dishesOf(), []);
});

searchTest("изоляция: поиск во втором ресторане не видит документы, блюда и состав подборок первого", async (client, [a, b]) => {
  // Одинаковые векторы в обоих ресторанах: отсекает только restaurant_id.
  const embed = labeledEmbed({ "метка-общая": similarTo(0.9), "Общее-блюдо": similarTo(0.8) });
  const dishA = await addDish(client, a, { name: "Общее-блюдо", price: 1 });
  const docA = await addDocument(client, a, { title: "A", body: "метка-общая", type: "collection" });
  await link(client, a, docA, [dishA]);
  await indexDocument({ client, embed }, docA);
  await indexDish({ client, embed }, dishA);

  const docB = await addDocument(client, b, { title: "B", body: "метка-общая", type: "collection" });
  await indexDocument({ client, embed }, docB);

  assertEquals(ids(await search(client, embed, a)), [docA, dishA]);
  const inB = await search(client, embed, b);
  assertEquals(ids(inB), [docB]);
  assert(inB[0].source === "document");
  assertEquals(inB[0].dishes, []);
}, 2);

searchTest("RPC: неверный лимит и порог — ошибка, а не выдача", async (client, [r]) => {
  const embedding = new Array<number>(EMBED_DIMENSIONS).fill(0);
  embedding[0] = 1;
  for (const [threshold, limit] of [[0.6, 0], [0.6, 21], [2, 5]]) {
    const { error } = await client.rpc("match_knowledge", {
      p_restaurant_id: r,
      p_embedding: embedding,
      p_threshold: threshold,
      p_limit: limit,
    });
    assert(error, `ожидали ошибку для порога ${threshold}, лимита ${limit}`);
  }
});
