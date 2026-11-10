import { assert, assertEquals, assertFalse } from "@std/assert";
import { ALLERGEN_LABELS, allergenLabel, EU_ALLERGEN_CODES, isAllergenCode } from "./allergens.ts";

Deno.test("справочник: ровно 14 аллергенов ЕС, без дублей", () => {
  assertEquals(EU_ALLERGEN_CODES.length, 14);
  assertEquals(new Set(EU_ALLERGEN_CODES).size, 14);
});

Deno.test("справочник: у каждого кода есть подпись", () => {
  for (const code of EU_ALLERGEN_CODES) assert(ALLERGEN_LABELS[code].trim() !== "", code);
});

Deno.test("isAllergenCode: коды да, слова и регистр — нет", () => {
  assert(isAllergenCode("milk"));
  assertFalse(isAllergenCode("молоко"));
  assertFalse(isAllergenCode("MILK"));
  assertFalse(isAllergenCode(""));
});

Deno.test("allergenLabel: код → подпись, неизвестное значение не прячем", () => {
  assertEquals(allergenLabel("nuts"), "орехи");
  assertEquals(allergenLabel("кокос"), "кокос");
});
