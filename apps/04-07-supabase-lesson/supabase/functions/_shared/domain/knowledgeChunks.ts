// Тексты для эмбеддингов базы знаний (S10 §4.7): нарезка документа на фрагменты и текст блюда.
// Чистые функции: их импортируют индексатор (services/knowledge.ts) и проверка поиска pnpm eval:rag —
// одна нарезка в индексе и в проверке, иначе результаты eval ничего не говорят о боевом поиске.

/**
 * Предел фрагмента документа вместе с названием — ≈ 600–800 токенов русского текста. Ориентир качества
 * поиска (§4.7): короче — фрагменты теряют контекст, длиннее — вектор «размазывается» по темам.
 */
export const MAX_CHUNK_CHARS = 2400;

/**
 * Предел текста блюда. Это не про качество, а про лимит модели (2048 токенов у gemini-embedding-001):
 * у полей menu_items нет ограничений длины, а молча усечённый состав дал бы неполный вектор (§4.7).
 * 4000 символов — с запасом ниже лимита даже при плотной токенизации кириллицы.
 */
export const MAX_DISH_TEXT_CHARS = 4000;

export interface ChunkableDocument {
  title: string;
  body: string;
}

/**
 * Документ → фрагменты для эмбеддинга, каждый начинается с названия документа: без него «Только по пятницам,
 * с 21:00» теряет тему. Правила:
 *   - есть заголовки `## ` — граница по разделам (текст до первого заголовка — отдельный раздел);
 *     заголовков нет — по абзацам;
 *   - мелкие соседние куски склеиваются, пока фрагмент с названием не превысит MAX_CHUNK_CHARS;
 *     короткий документ — один фрагмент;
 *   - длинный раздел делится по абзацам, затем предложениям, словам, в крайнем случае — по символам;
 *   - без перекрытия и без потери текста (теряются только пробелы на стыках).
 * Пустой текст — пустой массив.
 */
export function chunkDocument(doc: ChunkableDocument, maxChars = MAX_CHUNK_CHARS): string[] {
  const prefix = `${doc.title.trim()}. `;
  // Сколько места остаётся под текст в каждом фрагменте. Название до 200 символов (ограничение БД),
  // так что бюджет всегда большой; max(…, 1) — страховка от нелепого maxChars в тестах.
  const budget = Math.max(maxChars - prefix.length, 1);

  const hasHeadings = /^## /m.test(doc.body);
  const parts = (hasHeadings ? doc.body.split(/^(?=## )/m) : doc.body.split(PARAGRAPH))
    .map((p) => p.replace(/^## /, "").trim())
    .filter(Boolean);

  // Сначала каждый раздел ужимаем до бюджета, потом жадно склеиваем соседние куски.
  const pieces = parts.flatMap((part) => splitToFit(part, budget, 0));
  return pack(pieces, budget, "\n\n").map((text) => prefix + text);
}

/**
 * Уровни деления длинного текста: абзац → предложение → слово. Разделитель при обратной склейке —
 * свой для каждого уровня. Предложение режем после . ! ? … перед пробелом: «22:00.» и «т.е.» без пробела
 * не разрежутся, точность выше не нужна — это только запасной путь для очень длинных абзацев.
 */
const PARAGRAPH = /\n\s*\n/;
const LEVELS: { split: RegExp; joiner: string }[] = [
  { split: PARAGRAPH, joiner: "\n\n" },
  { split: /(?<=[.!?…])\s+/, joiner: " " },
  { split: /\s+/, joiner: " " },
];

/** Текст длиннее limit делится на куски не длиннее limit, каждый следующий уровень — только для тех, кто не влез. */
function splitToFit(text: string, limit: number, level: number): string[] {
  if (text.length <= limit) return [text];
  if (level >= LEVELS.length) return sliceChars(text, limit);
  const { split, joiner } = LEVELS[level];
  const pieces = text.split(split).map((p) => p.trim()).filter(Boolean);
  // Разделителя нет (одно огромное «слово» или абзац без точек) — сразу следующий уровень.
  if (pieces.length <= 1) return splitToFit(text, limit, level + 1);
  return pack(pieces.flatMap((p) => splitToFit(p, limit, level + 1)), limit, joiner);
}

/** Крайний случай: по символам. Array.from — по кодовым точкам, чтобы не разрезать эмодзи пополам. */
function sliceChars(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += limit) out.push(chars.slice(i, i + limit).join(""));
  return out;
}

/** Жадная склейка соседних кусков через joiner, пока результат не длиннее limit. Порядок сохраняется. */
function pack(pieces: string[], limit: number, joiner: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + joiner.length + piece.length > limit) {
      out.push(current);
      current = piece;
    } else {
      current = current ? current + joiner + piece : piece;
    }
  }
  if (current) out.push(current);
  return out;
}

export interface EmbeddableDish {
  name: string;
  /** null — категория удалена (FK on delete set null). */
  categoryName: string | null;
  description: string | null;
  ingredients: string | null;
}

/**
 * Блюдо → один фрагмент: название, категория, описание, состав. **Без аллергенов** (инвариант S10 §3):
 * вектор не понимает отрицаний («без орехов» близко к «орехи»), вопросы безопасности идут через
 * filterMenuByAllergens / getDishDetails. Цены и стоп-листа тоже нет — их читают из таблицы при поиске.
 */
export function dishEmbeddingText(dish: EmbeddableDish): string {
  const parts = [
    `${dish.name.trim()}.`,
    dish.categoryName?.trim() ? `${dish.categoryName.trim()}.` : null,
    dish.description?.trim() || null,
    dish.ingredients?.trim() ? `Состав: ${dish.ingredients.trim()}.` : null,
  ];
  return parts.filter(Boolean).join(" ");
}
