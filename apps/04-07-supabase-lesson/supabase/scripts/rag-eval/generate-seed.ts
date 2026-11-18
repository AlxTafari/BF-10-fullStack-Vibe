// Генерирует supabase/seed-knowledge.sql (меню + база знаний Лавраки) из dishes.json и documents.json.
// Мок-база — единственный источник: eval:rag и seed читают одни и те же данные и не расходятся.
// Запуск: pnpm seed:gen (после правки JSON). Файл seed-knowledge.sql руками не править.
import { RESTAURANT_ID, seedUuid } from "./seed-ids.ts";

interface Dish {
  id: string;
  category: string;
  name: string;
  description: string | null;
  ingredients: string | null;
  allergens: string[] | null;
  portion_grams?: number;
  kcal?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  price: number;
  published: boolean;
  available: boolean;
}

interface Doc {
  id: string;
  type: string;
  title: string;
  body: string;
  dishes?: string[];
}

// Типы документов — как в check-ограничении knowledge_documents.type (миграция 20261117100000).
const DOC_TYPES = new Set(["history", "team", "concept", "collection", "drinks", "event", "service", "season", "other"]);

const dir = new URL("./", import.meta.url);
const readJson = async <T>(name: string): Promise<T> => JSON.parse(await Deno.readTextFile(new URL(name, dir))) as T;

const { categories, dishes } = await readJson<{ categories: string[]; dishes: Dish[] }>("dishes.json");
const { documents } = await readJson<{ documents: Doc[] }>("documents.json");

// Постоянные uuid по позиции — seed-ids.ts (их же читает eval:rag --db).
const uuid = seedUuid;

const categoryIds = new Map(categories.map((name, i) => [name, uuid("b", i + 1)]));
const dishIds = new Map(dishes.map((d, i) => [d.id, uuid("c", i + 1)]));

// ---------------------------------------------------------------- проверки данных

const fail = (msg: string): never => {
  throw new Error(`мок-база: ${msg}`);
};
if (dishIds.size !== dishes.length) fail("повторяющийся id блюда");
if (new Set(documents.map((d) => d.id)).size !== documents.length) fail("повторяющийся id документа");
for (const d of dishes) if (!categoryIds.has(d.category)) fail(`категория «${d.category}» блюда ${d.id} не в categories`);
for (const doc of documents) {
  if (!DOC_TYPES.has(doc.type)) fail(`тип «${doc.type}» документа ${doc.id}`);
  // Те же пределы, что в БД: лучше упасть здесь, чем на середине seed.
  if (!doc.title.trim() || doc.title.length > 200) fail(`название документа ${doc.id}`);
  if (!doc.body.trim() || doc.body.length > 20000) fail(`текст документа ${doc.id}`);
  if (doc.dishes?.length && doc.type !== "collection") fail(`блюда у документа ${doc.id} не-подборки`);
  for (const id of doc.dishes ?? []) if (!dishIds.has(id)) fail(`документ ${doc.id}: нет блюда ${id}`);
}

// ---------------------------------------------------------------- SQL

const str = (v: string | null | undefined) => (v == null ? "null" : `'${v.replaceAll("'", "''")}'`);
const num = (v: number | null | undefined) => (v == null ? "null" : String(v));
// null = аллергены не указаны, '{}' = указано «нет» — различие важно для ответа про аллергию.
const arr = (v: string[] | null) => (v == null ? "null" : v.length ? `array[${v.map(str).join(", ")}]` : `'{}'::text[]`);
const r = str(RESTAURANT_ID);

const categoryRows = categories.map((name, i) => `    (${str(categoryIds.get(name))}, ${r}, ${str(name)}, ${i + 1})`);

const dishRows = dishes.map((d) =>
  `    (${str(dishIds.get(d.id))}, ${r}, ${str(categoryIds.get(d.category))}, ${str(d.name)},\n` +
  `     ${str(d.description)}, ${num(d.price)}, ${str(d.ingredients)}, ${arr(d.allergens)},\n` +
  `     ${num(d.portion_grams)}, ${num(d.kcal)}, ${num(d.protein)}, ${num(d.fat)}, ${num(d.carbs)}, ${d.published}, ${d.available})`
);

const docRows = documents.map((doc, i) =>
  `    (${str(uuid("d", i + 1))}, ${r}, ${str(doc.type)}, ${str(doc.title)},\n     ${str(doc.body)}, true)`
);

const linkRows = documents.flatMap((doc, i) =>
  (doc.dishes ?? []).map((id, pos) => `    (${str(uuid("d", i + 1))}, ${str(dishIds.get(id))}, ${r}, ${pos})`)
);

const sql = `-- СГЕНЕРИРОВАНО supabase/scripts/rag-eval/generate-seed.ts из dishes.json и documents.json.
-- Руками не править: правка JSON → pnpm seed:gen.
-- Меню и база знаний Лавраки: ${categories.length} категорий, ${dishes.length} блюд, ${documents.length} документов, ${linkRows.length} связей подборок.
-- Векторов нет: после seed документы и блюда «Ожидают индексации» (pnpm index:seed — сессия 2 S10).
-- Идемпотентный: удаляет и заново вставляет меню и документы ресторана, диалоги и заявки не трогает.

delete from knowledge_documents where restaurant_id = ${r};   -- связи и чанки — каскадом
delete from menu_items          where restaurant_id = ${r};
delete from menu_categories     where restaurant_id = ${r};

insert into menu_categories (id, restaurant_id, name, sort_order) values
${categoryRows.join(",\n")};

insert into menu_items (
    id, restaurant_id, category_id, name, description, price, ingredients, allergens,
    portion_grams, kcal_per_portion, protein_per_portion, fat_per_portion, carbs_per_portion,
    is_published, is_available
) values
${dishRows.join(",\n")};

insert into knowledge_documents (id, restaurant_id, type, title, body, is_published) values
${docRows.join(",\n")};

insert into knowledge_document_dishes (document_id, menu_item_id, restaurant_id, sort_order) values
${linkRows.join(",\n")};
`;

const out = new URL("../../seed-knowledge.sql", dir);
await Deno.writeTextFile(out, sql);
console.log(`seed-knowledge.sql: ${dishes.length} блюд, ${documents.length} документов, ${linkRows.length} связей`);
