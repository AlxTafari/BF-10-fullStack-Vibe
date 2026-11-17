import { assert, assertEquals, assertFalse } from "@std/assert";
import { ALLERGEN_LABELS, allergenLabel, EU_ALLERGEN_CODES, isAllergenCode, partitionByAllergens } from "./allergens.ts";

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

Deno.test("partitionByAllergens: три группы, null никогда не попадает в «можно»", () => {
  const items = [
    { name: "салат с орехами", allergens: ["nuts", "milk"] },
    { name: "суп", allergens: [] },
    { name: "паста", allergens: ["cereals_gluten", "eggs"] },
    { name: "десерт дня", allergens: null },
  ];
  const result = partitionByAllergens(items, ["nuts"]);
  assertEquals(result.free.map((i) => i.name), ["суп", "паста"]);
  assertEquals(result.contains.map((i) => i.name), ["салат с орехами"]);
  assertEquals(result.unknown.map((i) => i.name), ["десерт дня"]);
});

Deno.test("partitionByAllergens: несколько аллергенов — достаточно одного совпадения", () => {
  const items = [{ allergens: ["eggs"] }, { allergens: ["milk"] }, { allergens: ["fish"] }];
  const result = partitionByAllergens(items, ["milk", "eggs"]);
  assertEquals(result.contains.length, 2);
  assertEquals(result.free, [{ allergens: ["fish"] }]);
});
