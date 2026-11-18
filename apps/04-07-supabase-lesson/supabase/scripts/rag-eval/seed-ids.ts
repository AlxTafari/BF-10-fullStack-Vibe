// Постоянные uuid мок-базы в seed (S10): общие для генератора seed (generate-seed.ts) и проверки поиска по БД
// (eval-rag-search.ts --db), которой нужно сопоставить ответ match_knowledge с id из questions.json.

export const RESTAURANT_ID = "00000000-0000-0000-0000-00000000a001";

// Постоянные uuid по позиции: seed идемпотентный, а id в dev не меняются между перезаливами.
// Префикс — вид сущности (b — категория, c — блюдо, d — документ), всё валидный hex.
export const seedUuid = (prefix: "b" | "c" | "d", n: number) => `00000000-0000-0000-0000-00000000${prefix}${String(n).padStart(3, "0")}`;
