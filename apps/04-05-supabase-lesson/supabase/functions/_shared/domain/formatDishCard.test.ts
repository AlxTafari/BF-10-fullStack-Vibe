import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { ALLERGY_WARNING, formatDishCard, UNAVAILABLE_LABEL, type DishCardData } from "./formatDishCard.ts";
import { NO_DATA } from "./formatRestaurantInfo.ts";

const dorada: DishCardData = {
  name: "Дорада на гриле",
  description: "Цельная дорада.",
  price: 24,
  currency: "EUR",
  ingredients: "дорада, лимон",
  allergens: ["рыба"],
  portion_grams: 450,
  kcal_per_portion: 420,
  protein_per_portion: 52,
  fat_per_portion: 22,
  carbs_per_portion: 0,
  is_available: true,
};

Deno.test("ноль в КБЖУ показывается как 0, а не как «нет данных»", () => {
  const text = formatDishCard(dorada);
  assertStringIncludes(text, "420 ккал · Б 52 · Ж 22 · У 0");
});

Deno.test("нет ни одного значения КБЖУ — одна строка «нет данных»", () => {
  const text = formatDishCard({
    ...dorada,
    kcal_per_portion: null,
    protein_per_portion: null,
    fat_per_portion: null,
    carbs_per_portion: null,
  });
  assertStringIncludes(text, `КБЖУ на порцию: ${NO_DATA}`);
});

Deno.test("частично заполненное КБЖУ: пропуски — тире", () => {
  const text = formatDishCard({ ...dorada, kcal_per_portion: 300, protein_per_portion: null });
  assertStringIncludes(text, "300 ккал · Б — · Ж 22 · У 0");
});

Deno.test("состав и порция null → «нет данных»", () => {
  const text = formatDishCard({ ...dorada, ingredients: null, portion_grams: null });
  assertStringIncludes(text, `Состав: ${NO_DATA}`);
  assertStringIncludes(text, `Порция: ${NO_DATA}`);
});

Deno.test("аллергены: null, пустой список и список различаются", () => {
  assertStringIncludes(formatDishCard({ ...dorada, allergens: null }), `Аллергены: ${NO_DATA}`);
  assertStringIncludes(formatDishCard({ ...dorada, allergens: [] }), "Аллергены: нет (по данным карточки)");
  assertStringIncludes(formatDishCard({ ...dorada, allergens: ["молоко", "яйца"] }), "Аллергены: молоко, яйца");
});

Deno.test("предупреждение про аллергию — на любой карточке", () => {
  assertStringIncludes(formatDishCard(dorada), ALLERGY_WARNING);
  assertStringIncludes(formatDishCard({ ...dorada, allergens: [] }), ALLERGY_WARNING);
});

Deno.test("недоступное блюдо помечено первой строкой", () => {
  const lines = formatDishCard({ ...dorada, is_available: false }).split("\n");
  assertEquals(lines[0], UNAVAILABLE_LABEL);
  assertEquals(formatDishCard(dorada).includes(UNAVAILABLE_LABEL), false);
});
