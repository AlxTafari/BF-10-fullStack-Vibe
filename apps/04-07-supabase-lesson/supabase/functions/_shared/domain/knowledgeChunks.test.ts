import { assert, assertEquals } from "@std/assert";
import { chunkDocument, dishEmbeddingText, MAX_CHUNK_CHARS } from "./knowledgeChunks.ts";

/** Слова текста без маркеров заголовков — по ним проверяем «без потери и без перекрытия». */
const words = (text: string) => text.replace(/^## /gm, "").split(/\s+/).filter(Boolean);
const bodyOf = (chunks: string[], title: string) => chunks.map((c) => c.slice(`${title}. `.length));

/** Проверки, общие для всех случаев: префикс, предел длины, текст целиком и по порядку. */
function assertChunking(title: string, body: string, chunks: string[], max = MAX_CHUNK_CHARS) {
  for (const chunk of chunks) {
    assert(chunk.startsWith(`${title}. `), `фрагмент без названия: ${chunk.slice(0, 40)}`);
    assert(chunk.length <= max, `фрагмент длиннее ${max}: ${chunk.length}`);
  }
  assertEquals(bodyOf(chunks, title).flatMap(words), words(body));
}

Deno.test("chunkDocument: короткий документ — один фрагмент с названием", () => {
  const chunks = chunkDocument({ title: "Живая музыка", body: "Только по пятницам, с 21:00.\n\nВход свободный." });
  assertEquals(chunks, ["Живая музыка. Только по пятницам, с 21:00.\n\nВход свободный."]);
});

Deno.test("chunkDocument: пустой и пробельный текст — нет фрагментов", () => {
  assertEquals(chunkDocument({ title: "Пусто", body: "" }), []);
  assertEquals(chunkDocument({ title: "Пусто", body: "  \n\n  " }), []);
});

Deno.test("chunkDocument: разделы ## склеиваются, пока влезают; граница — по разделу", () => {
  const section = (name: string, size: number) => `## ${name}\n${"слово ".repeat(size).trim()}`;
  // Три раздела по ~600 символов влезают в один фрагмент, четвёртый большой уходит в следующий.
  const body = [section("Зал", 100), section("Терраса", 100), section("Меню", 100), section("Цены", 330)].join("\n\n");
  const chunks = chunkDocument({ title: "Банкеты", body });
  assertEquals(chunks.length, 2);
  assert(chunks[0].includes("Зал") && chunks[0].includes("Меню") && !chunks[0].includes("Цены"));
  assert(chunks[1].startsWith("Банкеты. Цены"));
  assertChunking("Банкеты", body, chunks);
});

Deno.test("chunkDocument: текст до первого заголовка — отдельный раздел, не теряется", () => {
  const body = "Вступление.\n\n## Раздел\nТекст раздела.";
  assertEquals(chunkDocument({ title: "Док", body }), ["Док. Вступление.\n\nРаздел\nТекст раздела."]);
});

Deno.test("chunkDocument: длинный раздел делится по абзацам, каждый фрагмент в пределе", () => {
  const paragraph = (i: number) => `Абзац ${i}. ${"текст ".repeat(150).trim()}.`;
  const body = `## Большой раздел\n${Array.from({ length: 6 }, (_, i) => paragraph(i)).join("\n\n")}`;
  const chunks = chunkDocument({ title: "История", body });
  assert(chunks.length > 1);
  assertChunking("История", body, chunks);
});

Deno.test("chunkDocument: длинный абзац без пустых строк делится по предложениям", () => {
  const sentence = (i: number) => `Предложение номер ${i} ${"про кухню ".repeat(20).trim()}.`;
  const body = Array.from({ length: 30 }, (_, i) => sentence(i)).join(" ");
  const chunks = chunkDocument({ title: "Кухня", body });
  assert(chunks.length > 1);
  // Граница — конец предложения: каждый фрагмент (кроме названия) заканчивается точкой.
  for (const text of bodyOf(chunks, "Кухня")) assert(text.endsWith("."), text.slice(-20));
  assertChunking("Кухня", body, chunks);
});

Deno.test("chunkDocument: предложение длиннее предела делится по словам", () => {
  const body = "слово ".repeat(1000).trim();
  const chunks = chunkDocument({ title: "Слова", body });
  assert(chunks.length > 1);
  assertChunking("Слова", body, chunks);
});

Deno.test("chunkDocument: слово длиннее предела режется по символам без потери", () => {
  const long = "а".repeat(5000);
  const chunks = chunkDocument({ title: "Длинное", body: `начало ${long} конец` });
  assert(chunks.length >= 3);
  for (const chunk of chunks) assert(chunk.length <= MAX_CHUNK_CHARS);
  assertEquals(bodyOf(chunks, "Длинное").join(" ").replace(/\s+/g, ""), `начало${long}конец`);
});

Deno.test("chunkDocument: название учитывается в пределе", () => {
  const title = "Н".repeat(200);
  const body = "слово ".repeat(500).trim();
  const chunks = chunkDocument({ title, body }, 600);
  assertChunking(title, body, chunks, 600);
});

Deno.test("dishEmbeddingText: название, категория, описание, состав — без аллергенов и цены", () => {
  const dish = {
    name: "Мидии саганаки",
    categoryName: "Горячее",
    description: "Мидии в томатах с фетой.",
    ingredients: "мидии, томаты, фета",
    allergens: ["molluscs", "milk"],
    price: 890,
  };
  assertEquals(dishEmbeddingText(dish), "Мидии саганаки. Горячее. Мидии в томатах с фетой. Состав: мидии, томаты, фета.");
});

Deno.test("dishEmbeddingText: пустые поля и удалённая категория пропускаются", () => {
  assertEquals(dishEmbeddingText({ name: "Хлеб", categoryName: null, description: "  ", ingredients: null }), "Хлеб.");
});
