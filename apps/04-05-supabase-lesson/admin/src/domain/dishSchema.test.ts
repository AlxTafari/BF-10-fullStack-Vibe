import { describe, expect, it } from "vitest";
import {
  EMPTY_DISH,
  NO_CATEGORY,
  type DishFormValues,
  type DishRecord,
  addTag,
  dishSchema,
  lacksNutrition,
  parseNumber,
  removeTag,
  toDishPayload,
  toFormValues,
} from "./dishSchema";

const valid = (patch: Partial<DishFormValues> = {}): DishFormValues => ({ ...EMPTY_DISH, name: "Борщ", price: "350", ...patch });
const ok = (patch: Partial<DishFormValues>) => dishSchema.safeParse(valid(patch)).success;

describe("parseNumber", () => {
  const rule = { decimals: 2, limit: 1e8 };
  it("пусто → null, ноль → 0", () => {
    expect(parseNumber("", rule)).toEqual({ value: null });
    expect(parseNumber("   ", rule)).toEqual({ value: null });
    expect(parseNumber("0", rule)).toEqual({ value: 0 });
    expect(parseNumber("0,0", { decimals: 1, limit: 10 })).toEqual({ value: 0 });
  });
  it("запятая и точка", () => {
    expect(parseNumber("12,5", rule)).toEqual({ value: 12.5 });
    expect(parseNumber("12.5", rule)).toEqual({ value: 12.5 });
  });
  it("лишние знаки, минус, мусор", () => {
    expect(parseNumber("1.234", rule)).toHaveProperty("error");
    expect(parseNumber("-1", rule)).toHaveProperty("error");
    expect(parseNumber("abc", rule)).toHaveProperty("error");
    expect(parseNumber("1e3", rule)).toHaveProperty("error");
    expect(parseNumber("1,2,3", rule)).toHaveProperty("error");
  });
  it("предел колонки и positive", () => {
    expect(parseNumber("100000000", rule)).toHaveProperty("error");
    expect(parseNumber("99999999.99", rule)).toEqual({ value: 99999999.99 });
    expect(parseNumber("0", { decimals: 0, limit: 1e6, positive: true })).toHaveProperty("error");
  });
});

describe("dishSchema", () => {
  it("минимально валидное блюдо", () => {
    expect(dishSchema.safeParse(valid()).success).toBe(true);
  });
  it("название обязательно, ≤120", () => {
    expect(ok({ name: "  " })).toBe(false);
    expect(ok({ name: "я".repeat(121) })).toBe(false);
  });
  it("цена обязательна, 0 допустим, ≤2 знаков", () => {
    expect(ok({ price: "" })).toBe(false);
    expect(ok({ price: "0" })).toBe(true);
    expect(ok({ price: "199,90" })).toBe(true);
    expect(ok({ price: "1.999" })).toBe(false);
    expect(ok({ price: "-5" })).toBe(false);
  });
  it("порция: пусто можно, 0 нельзя, дробь нельзя", () => {
    expect(ok({ portion_grams: "" })).toBe(true);
    expect(ok({ portion_grams: "0" })).toBe(false);
    expect(ok({ portion_grams: "250" })).toBe(true);
    expect(ok({ portion_grams: "2.5" })).toBe(false);
  });
  it("КБЖУ: 0 допустим, 1 знак", () => {
    expect(ok({ fat_per_portion: "0" })).toBe(true);
    expect(ok({ kcal_per_portion: "250,5" })).toBe(true);
    expect(ok({ kcal_per_portion: "250.55" })).toBe(false);
  });
  it("photo_url: только http(s)", () => {
    expect(ok({ photo_url: "" })).toBe(true);
    expect(ok({ photo_url: "https://x.example/a.jpg" })).toBe(true);
    expect(ok({ photo_url: "javascript:alert(1)" })).toBe(false);
    expect(ok({ photo_url: "ftp://x" })).toBe(false);
  });
  it("аллергены: режим «Указать» без тегов — ошибка, остальные режимы без тегов можно", () => {
    expect(ok({ allergenMode: "list", allergenTags: [] })).toBe(false);
    expect(ok({ allergenMode: "list", allergenTags: ["орехи"] })).toBe(true);
    expect(ok({ allergenMode: "none" })).toBe(true);
    expect(ok({ allergenMode: "unset" })).toBe(true);
  });
});

describe("toDishPayload", () => {
  it("пустое → null, ноль → 0 (КБЖУ и порция)", () => {
    const p = toDishPayload(
      valid({ fat_per_portion: "0", kcal_per_portion: "", price: "0", description: "  ", photo_url: "" }),
    );
    expect(p.fat_per_portion).toBe(0);
    expect(p.kcal_per_portion).toBeNull();
    expect(p.price).toBe(0);
    expect(p.description).toBeNull();
    expect(p.photo_url).toBeNull();
  });
  it("запятая → число; категория none → null", () => {
    expect(toDishPayload(valid({ price: "12,5" })).price).toBe(12.5);
    expect(toDishPayload(valid({ category_id: NO_CATEGORY })).category_id).toBeNull();
    expect(toDishPayload(valid({ category_id: "abc" })).category_id).toBe("abc");
  });
  it("три состояния аллергенов: null / [] / список", () => {
    expect(toDishPayload(valid({ allergenMode: "unset", allergenTags: ["x"] })).allergens).toBeNull();
    expect(toDishPayload(valid({ allergenMode: "none", allergenTags: ["x"] })).allergens).toEqual([]);
    expect(toDishPayload(valid({ allergenMode: "list", allergenTags: ["орехи", "молоко"] })).allergens).toEqual([
      "орехи",
      "молоко",
    ]);
  });
});

describe("toFormValues", () => {
  const record: DishRecord = {
    name: "Чай",
    category_id: null,
    description: null,
    ingredients: null,
    price: 0,
    portion_grams: null,
    kcal_per_portion: 0,
    protein_per_portion: null,
    fat_per_portion: 0,
    carbs_per_portion: null,
    allergens: [],
    photo_url: null,
    is_published: true,
    is_available: false,
  };

  it("ноль остаётся «0», null — пустое поле", () => {
    const v = toFormValues(record);
    expect(v.price).toBe("0");
    expect(v.kcal_per_portion).toBe("0");
    expect(v.protein_per_portion).toBe("");
    expect(v.category_id).toBe(NO_CATEGORY);
  });
  it("аллергены: [] → режим «нет», null → «не указано», список → «указать»", () => {
    expect(toFormValues(record).allergenMode).toBe("none");
    expect(toFormValues({ ...record, allergens: null }).allergenMode).toBe("unset");
    expect(toFormValues({ ...record, allergens: ["орехи"] })).toMatchObject({ allergenMode: "list", allergenTags: ["орехи"] });
  });
  it("круговой обход не меняет данные", () => {
    for (const allergens of [null, [], ["орехи", "глютен"]]) {
      const r = { ...record, allergens, protein_per_portion: 3.5 };
      const { name, ...rest } = toDishPayload(toFormValues(r));
      expect({ name, ...rest }).toEqual(r);
    }
  });
});

describe("lacksNutrition", () => {
  it("true, если хоть одно из четырёх null; нули — это данные", () => {
    const all = { kcal_per_portion: 0, protein_per_portion: 0, fat_per_portion: 0, carbs_per_portion: 0 };
    expect(lacksNutrition(all)).toBe(false);
    expect(lacksNutrition({ ...all, fat_per_portion: null })).toBe(true);
  });
});

describe("теги аллергенов", () => {
  it("trim, без пустых и дублей, регистр не меняется", () => {
    expect(addTag([], "  орехи ")).toEqual(["орехи"]);
    expect(addTag(["орехи"], "орехи")).toEqual(["орехи"]);
    expect(addTag(["орехи"], "Орехи")).toEqual(["орехи", "Орехи"]);
    expect(addTag(["орехи"], "   ")).toEqual(["орехи"]);
  });
  it("removeTag", () => {
    expect(removeTag(["a", "b"], "a")).toEqual(["b"]);
  });
});
