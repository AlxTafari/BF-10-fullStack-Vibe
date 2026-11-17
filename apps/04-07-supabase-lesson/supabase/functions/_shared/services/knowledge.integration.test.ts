// Интеграционные тесты индексации базы знаний (S10, сессия 2) на фейковых эмбеддингах: без сети Gemini, с настоящей БД.
// Запуск: deno test --allow-env --allow-net --allow-read --env-file=../../.env _shared/services/knowledge.integration.test.ts
// Без SUPABASE_URL тесты пропускаются. Каждый тест заводит свой ресторан и удаляет его (каскад уносит документы,
// блюда и чанки). Свежий ресторан не мешает остальным тестам: getRestaurant берёт самый старый.
//
// Гонки разыгрываются управляемым эмбеддером: вызов embed «висит», пока тест его не отпустит. Так порядок
// «попытка A началась → правка → попытка B → B закончилась → A закончилась» воспроизводится детерминированно.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkDocument, dishEmbeddingText } from "../domain/knowledgeChunks.ts";
import { fakeEmbed, fakeVector } from "../llm/fakeEmbed.ts";
import { type Embedder, LlmError } from "../llm/types.ts";
import { createServiceClient } from "../supabaseClient.ts";
import {
  indexDish,
  indexDocument,
  type KnowledgeIndexDeps,
  PORTION,
  reindexAll,
  type ReindexSummary,
  type SourceRef,
} from "./knowledge.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/** Обёртка теста: свой ресторан на время теста, удаление в finally. */
function knowledgeTest(name: string, fn: (client: SupabaseClient, restaurantId: string) => Promise<void>) {
  Deno.test({
    name: `база знаний: ${name}`,
    ignore: !enabled,
    // supabase-js держит соединения; тест сам ничего не оставляет открытым.
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const client = createServiceClient();
      const { data, error } = await client.from("restaurants").insert({ name: "knowledge-integration-test" }).select("id").single();
      if (error) throw error;
      try {
        await fn(client, data.id);
      } finally {
        await client.from("restaurants").delete().eq("id", data.id);
      }
    },
  });
}

// ---------------------------------------------------------------- данные

async function addDocument(
  client: SupabaseClient,
  restaurantId: string,
  doc: { title: string; body: string; published?: boolean },
): Promise<string> {
  const { data, error } = await client.from("knowledge_documents").insert({
    restaurant_id: restaurantId,
    title: doc.title,
    body: doc.body,
    type: "other",
    is_published: doc.published ?? true,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function updateDocument(client: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await client.from("knowledge_documents").update(patch).eq("id", id);
  if (error) throw error;
}

interface IndexState {
  index_status: string;
  index_error: string | null;
  index_revision: number;
  indexed_revision: number | null;
}

async function documentState(client: SupabaseClient, id: string): Promise<IndexState> {
  const { data, error } = await client.from("knowledge_documents")
    .select("index_status, index_error, index_revision, indexed_revision").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function chunksOf(client: SupabaseClient, column: "document_id" | "menu_item_id", id: string): Promise<string[]> {
  const { data, error } = await client.from("knowledge_chunks").select("content").eq(column, id).order("chunk_index");
  if (error) throw error;
  return (data ?? []).map((row: { content: string }) => row.content);
}

/** Документ длиннее предела фрагмента: три раздела по ~1500 символов — нарезка даёт несколько фрагментов. */
function longBody(tag: string): string {
  const section = (n: number) => `## Раздел ${n}\n\n` + `Факт ${tag} номер ${n}. `.repeat(70);
  return [1, 2, 3].map(section).join("\n\n");
}

// ---------------------------------------------------------------- управляемый эмбеддер

/**
 * Каждый вызов embed ждёт, пока тест не вызовет release (успех на fakeVector) или fail (ошибка).
 * call(n) дожидается n-го вызова (с нуля): после него попытка гарантированно выдана и снимок снят.
 */
function controlledEmbed() {
  const calls: { texts: string[]; release: () => void; fail: (error: Error) => void }[] = [];
  let notify: () => void = () => {};
  const embed: Embedder = (texts) =>
    new Promise((resolve, reject) => {
      calls.push({ texts, release: () => resolve(texts.map(fakeVector)), fail: reject });
      notify();
    });
  const call = async (n: number) => {
    while (calls.length <= n) await new Promise<void>((resolve) => (notify = resolve));
    return calls[n];
  };
  return { embed, call };
}

const deps = (client: SupabaseClient, embed: Embedder = fakeEmbed): KnowledgeIndexDeps => ({ client, embed });

// ---------------------------------------------------------------- тесты

knowledgeTest("документ: чанки — ровно нарезка, статус ready, повтор не дублирует", async (client, restaurantId) => {
  const doc = { title: "Банкеты", body: longBody("банкет") };
  const id = await addDocument(client, restaurantId, doc);
  const expected = chunkDocument(doc);
  assert(expected.length > 1, "тестовый документ должен давать несколько фрагментов");

  assertEquals(await indexDocument(deps(client), id), { status: "ready" });
  assertEquals(await chunksOf(client, "document_id", id), expected);
  const state = await documentState(client, id);
  assertEquals(state.index_status, "ready");
  assertEquals(state.indexed_revision, state.index_revision);

  // Повторная индексация неизменённого: те же чанки, без дублей, версия та же.
  assertEquals(await indexDocument(deps(client), id), { status: "ready" });
  assertEquals(await chunksOf(client, "document_id", id), expected);
  assertEquals((await documentState(client, id)).index_revision, state.index_revision);
});

knowledgeTest("блюдо: один фрагмент без аллергенов; неопубликованное — skipped, pending без ошибки", async (client, restaurantId) => {
  const { data: category, error: catError } = await client.from("menu_categories")
    .insert({ restaurant_id: restaurantId, name: "Горячее" }).select("id").single();
  if (catError) throw catError;
  const { data: dishes, error } = await client.from("menu_items").insert([
    {
      restaurant_id: restaurantId,
      category_id: category.id,
      name: "Мусака",
      description: "Запеканка из баклажанов",
      ingredients: "баклажан, фарш, бешамель",
      allergens: ["milk", "gluten"],
      price: 650,
      is_published: true,
    },
    { restaurant_id: restaurantId, category_id: category.id, name: "Секретное блюдо", price: 100, is_published: false },
  ]).select("id, name");
  if (error) throw error;
  const published = dishes.find((d: { name: string }) => d.name === "Мусака")!.id;
  const hidden = dishes.find((d: { name: string }) => d.name === "Секретное блюдо")!.id;

  assertEquals(await indexDish(deps(client), published), { status: "ready" });
  const chunks = await chunksOf(client, "menu_item_id", published);
  assertEquals(chunks, [
    dishEmbeddingText({
      name: "Мусака",
      categoryName: "Горячее",
      description: "Запеканка из баклажанов",
      ingredients: "баклажан, фарш, бешамель",
    }),
  ]);
  assert(!/milk|gluten|аллерген/i.test(chunks[0]), "аллергенов в тексте эмбеддинга быть не должно");

  assertEquals(await indexDish(deps(client), hidden), { status: "skipped" });
  const { data: state } = await client.from("menu_items").select("index_status, index_error").eq("id", hidden).single();
  assertEquals(state, { index_status: "pending", index_error: null });
  assertEquals(await chunksOf(client, "menu_item_id", hidden), []);
});

knowledgeTest("сбой эмбеддинга: error с безопасным текстом, старые чанки на месте", async (client, restaurantId) => {
  const id = await addDocument(client, restaurantId, { title: "Оплата", body: "Принимаем наличные и карты." });
  await indexDocument(deps(client), id);
  const oldChunks = await chunksOf(client, "document_id", id);

  await updateDocument(client, id, { body: "Принимаем наличные, карты и СБП." });
  // В сообщении провайдера — «секрет»: в index_error он попасть не должен.
  const failing: Embedder = () => Promise.reject(new LlmError("timeout", "secret-key-123 timed out"));
  const outcome = await indexDocument(deps(client, failing), id);
  assertEquals(outcome.status, "error");

  const state = await documentState(client, id);
  assertEquals(state.index_status, "error");
  assert(state.index_error?.includes("Gemini не ответил вовремя"), state.index_error ?? "");
  assert(!state.index_error?.includes("secret"), "в index_error не должно быть текста провайдера");
  // Старые чанки сохранены, но версия уже не совпадает: поиск (сессия 3) их не возьмёт.
  assertEquals(await chunksOf(client, "document_id", id), oldChunks);
  assertNotEquals(state.indexed_revision, state.index_revision);
});

knowledgeTest("ответы A/B в обратном порядке: побеждает попытка по новой редакции", async (client, restaurantId) => {
  const id = await addDocument(client, restaurantId, { title: "Часы", body: "Редакция один." });
  const { embed, call } = controlledEmbed();

  const a = indexDocument(deps(client, embed), id);
  const callA = await call(0);
  await updateDocument(client, id, { body: "Редакция два." });
  const b = indexDocument(deps(client, embed), id);
  const callB = await call(1);

  callB.release();
  assertEquals(await b, { status: "ready" });
  callA.release();
  assertEquals(await a, { status: "superseded" });

  assertEquals(await chunksOf(client, "document_id", id), ["Часы. Редакция два."]);
  const state = await documentState(client, id);
  assertEquals(state.index_status, "ready");
  assertEquals(state.indexed_revision, state.index_revision);
});

knowledgeTest("две попытки по одной редакции: старая попытка superseded", async (client, restaurantId) => {
  const id = await addDocument(client, restaurantId, { title: "Парковка", body: "Парковка во дворе." });
  const { embed, call } = controlledEmbed();

  const a = indexDocument(deps(client, embed), id);
  const callA = await call(0);
  const b = indexDocument(deps(client, embed), id);
  const callB = await call(1);
  callB.release();
  assertEquals(await b, { status: "ready" });
  callA.release();
  assertEquals(await a, { status: "superseded" });
});

knowledgeTest("поздняя ошибка не затирает успех новой попытки", async (client, restaurantId) => {
  const id = await addDocument(client, restaurantId, { title: "Терраса", body: "Терраса открыта с мая." });
  const { embed, call } = controlledEmbed();

  const a = indexDocument(deps(client, embed), id);
  const callA = await call(0);
  const b = indexDocument(deps(client, embed), id);
  (await call(1)).release();
  assertEquals(await b, { status: "ready" });

  callA.fail(new LlmError("unavailable", "late failure"));
  assertEquals(await a, { status: "superseded" });
  const state = await documentState(client, id);
  assertEquals(state.index_status, "ready");
  assertEquals(state.index_error, null);
});

knowledgeTest("снятие с публикации и удаление во время эмбеддинга: чанков нет, результат отброшен", async (client, restaurantId) => {
  const unpublishId = await addDocument(client, restaurantId, { title: "Акция", body: "Скидка по средам." });
  await indexDocument(deps(client), unpublishId);
  const deleteId = await addDocument(client, restaurantId, { title: "Сезон", body: "Летнее меню." });
  const { embed, call } = controlledEmbed();

  // Снятие с публикации: триггер удаляет чанки сразу, поздний результат не возвращает их.
  const a = indexDocument(deps(client, embed), unpublishId);
  const callA = await call(0);
  await updateDocument(client, unpublishId, { is_published: false });
  assertEquals(await chunksOf(client, "document_id", unpublishId), []);
  callA.release();
  assertEquals(await a, { status: "superseded" });
  assertEquals(await chunksOf(client, "document_id", unpublishId), []);
  assertEquals((await documentState(client, unpublishId)).index_status, "pending");

  // Удаление: источника нет — запись не делается, ошибки нет.
  const b = indexDocument(deps(client, embed), deleteId);
  const callB = await call(1);
  await client.from("knowledge_documents").delete().eq("id", deleteId);
  callB.release();
  assertEquals(await b, { status: "superseded" });
  assertEquals(await chunksOf(client, "document_id", deleteId), []);
});

knowledgeTest("массовая индексация и правка источника в процессе: superseded, источник ждёт новой попытки", async (client, restaurantId) => {
  const id = await addDocument(client, restaurantId, { title: "Дети", body: "Есть детские стульчики." });
  const { embed, call } = controlledEmbed();

  const portion = reindexAll(deps(client, embed), restaurantId, null, { ...PORTION, concurrency: 1 });
  const first = await call(0);
  await updateDocument(client, id, { body: "Есть детские стульчики и раскраски." });
  first.release();
  const summary = await portion;
  assertEquals({ ...summary, errors: summary.errors.length }, {
    ready: 0,
    error: 0,
    skipped: 0,
    superseded: 1,
    errors: 0,
    nextCursor: null,
  });
  assertEquals((await documentState(client, id)).index_status, "pending");

  assertEquals(await indexDocument(deps(client), id), { status: "ready" });
  assertEquals(await chunksOf(client, "document_id", id), ["Дети. Есть детские стульчики и раскраски."]);
});

/** Все порции до nextCursor = null, как делает админка. Возвращает сумму и список курсоров. */
async function runAllPortions(run: (cursor: SourceRef | null) => Promise<ReindexSummary>) {
  const total = { ready: 0, error: 0, skipped: 0, superseded: 0, errors: [] as ReindexSummary["errors"] };
  const cursors: (SourceRef | null)[] = [];
  let cursor: SourceRef | null = null;
  do {
    const portion: ReindexSummary = await run(cursor);
    total.ready += portion.ready;
    total.error += portion.error;
    total.skipped += portion.skipped;
    total.superseded += portion.superseded;
    total.errors.push(...portion.errors);
    cursor = portion.nextCursor;
    cursors.push(cursor);
    assert(cursors.length < 20, "порции не заканчиваются");
  } while (cursor);
  return { total, portions: cursors.length };
}

knowledgeTest("частичный сбой массовой индексации: остальные проиндексированы, продолжение по курсору", async (client, restaurantId) => {
  await addDocument(client, restaurantId, { title: "Один", body: "Первый документ." });
  const broken = await addDocument(client, restaurantId, { title: "Два", body: "СБОЙ в этом документе." });
  await addDocument(client, restaurantId, { title: "Три", body: "Третий документ." });
  await addDocument(client, restaurantId, { title: "Черновик", body: "Не опубликован.", published: false });

  // Падает только пачка, где есть «СБОЙ»: остальные источники идут как обычно.
  const flaky: Embedder = (texts, ...rest) =>
    texts.some((t) => t.includes("СБОЙ")) ? Promise.reject(new LlmError("quota", "429")) : fakeEmbed(texts, ...rest);

  const { total, portions } = await runAllPortions((cursor) =>
    reindexAll(deps(client, flaky), restaurantId, cursor, { ...PORTION, size: 2 })
  );
  assertEquals(portions, 2, "4 источника порциями по 2");
  assertEquals({ ready: total.ready, error: total.error, skipped: total.skipped, superseded: total.superseded }, {
    ready: 2,
    error: 1,
    skipped: 1,
    superseded: 0,
  });
  assertEquals(total.errors.map((e) => e.id), [broken]);
  assert(total.errors[0].message.includes("лимит"), total.errors[0].message);
  assertEquals((await documentState(client, broken)).index_status, "error");

  // Повторный запуск безопасен: после «починки» провайдера всё ready, дублей чанков нет.
  const again = await runAllPortions((cursor) => reindexAll(deps(client), restaurantId, cursor, { ...PORTION, size: 2 }));
  assertEquals({ ready: again.total.ready, error: again.total.error }, { ready: 3, error: 0 });
  assertEquals(await chunksOf(client, "document_id", broken), ["Два. СБОЙ в этом документе."]);
});

knowledgeTest("бюджет порции кончился: новые источники не начинаются, курсор не пропускает незавершённые", async (client, restaurantId) => {
  const ids = [
    await addDocument(client, restaurantId, { title: "А", body: "Документ А." }),
    await addDocument(client, restaurantId, { title: "Б", body: "Документ Б." }),
    await addDocument(client, restaurantId, { title: "В", body: "Документ В." }),
  ];
  // Часы двигает сам эмбеддер: каждый источник «занимает» 60 мс из бюджета 100, новый начинается при остатке ≥ 50.
  let clock = 0;
  const slow: Embedder = (texts, ...rest) => {
    clock += 60;
    return fakeEmbed(texts, ...rest);
  };
  const limits = { size: 10, concurrency: 1, budgetMs: 100, minStartMs: 50 };

  const { total, portions } = await runAllPortions((cursor) =>
    reindexAll({ client, embed: slow, now: () => clock }, restaurantId, cursor, limits)
  );
  assertEquals(portions, 3, "по одному источнику за порцию");
  assertEquals(total.ready, ids.length);
  for (const id of ids) assertEquals((await documentState(client, id)).index_status, "ready");
});
