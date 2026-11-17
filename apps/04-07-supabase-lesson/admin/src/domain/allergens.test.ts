import { describe, expect, it } from "vitest";
import { ALLERGEN_LABELS, EU_ALLERGEN_CODES, isAllergenCode, toggleAllergen } from "./allergens";

describe("справочник аллергенов ЕС", () => {
  it("14 кодов без дублей, у каждого подпись", () => {
    expect(EU_ALLERGEN_CODES).toHaveLength(14);
    expect(new Set(EU_ALLERGEN_CODES).size).toBe(14);
    for (const code of EU_ALLERGEN_CODES) expect(ALLERGEN_LABELS[code].trim()).not.toBe("");
  });

  it("isAllergenCode: только коды", () => {
    expect(isAllergenCode("nuts")).toBe(true);
    expect(isAllergenCode("орехи")).toBe(false);
  });
});

describe("toggleAllergen", () => {
  it("результат в порядке справочника, независимо от порядка кликов", () => {
    expect(toggleAllergen(["milk"], "cereals_gluten", true)).toEqual(["cereals_gluten", "milk"]);
  });
  it("повторная отметка не дублирует, снятие убирает", () => {
    expect(toggleAllergen(["milk"], "milk", true)).toEqual(["milk"]);
    expect(toggleAllergen(["milk", "nuts"], "milk", false)).toEqual(["nuts"]);
    expect(toggleAllergen([], "nuts", false)).toEqual([]);
  });
});
