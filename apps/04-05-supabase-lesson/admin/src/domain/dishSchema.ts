import { z } from "zod";

// Форма блюда. Значения — строки как в полях ввода; правила «пусто → null, 0 → 0» живут здесь и в toDishPayload.
// Валидация зеркалит check-ограничения БД, чтобы ошибка показывалась в поле, а не как «violates check constraint».

/** Значение Select для «Без категории» (пустую строку Radix Select не принимает). */
export const NO_CATEGORY = "none";

export type AllergenMode = "unset" | "none" | "list";

interface NumberRule {
  /** Максимум знаков после запятой (0 — только целые). */
  decimals: number;
  /** Строго меньше этого значения — предел колонки numeric(p, s) / int. */
  limit: number;
  /** Нижняя граница: true — значение должно быть > 0, иначе ≥ 0. */
  positive?: boolean;
}

type Parsed = { value: number | null } | { error: string };

/**
 * Разбор числа из поля ввода. Запятая и точка равноправны.
 * Пусто → null (значение не указано); «0» → 0 (указан ноль) — это разные вещи.
 */
export function parseNumber(raw: string, rule: NumberRule): Parsed {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { value: null };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: "Введите неотрицательное число" };
  const fraction = text.split(".")[1] ?? "";
  if (fraction.length > rule.decimals) {
    return { error: rule.decimals === 0 ? "Только целое число" : `Не более ${rule.decimals} зн. после запятой` };
  }
  const value = Number(text);
  if (rule.positive && value <= 0) return { error: "Должно быть больше 0" };
  if (value >= rule.limit) return { error: "Слишком большое число" };
  return { value };
}

const PRICE: NumberRule = { decimals: 2, limit: 1e8 }; // numeric(10,2)
const PORTION: NumberRule = { decimals: 0, limit: 1e6, positive: true }; // int, > 0
const NUTRIENT: NumberRule = { decimals: 1, limit: 1e6 }; // numeric(7,1)

/** Необязательное числовое поле: ошибка разбора → issue, пусто допустимо. */
const optionalNumber = (rule: NumberRule) =>
  z.string().superRefine((raw, ctx) => {
    const r = parseNumber(raw, rule);
    if ("error" in r) ctx.addIssue({ code: "custom", message: r.error });
  });

export const dishSchema = z
  .object({
    name: z.string().trim().min(1, "Введите название").max(120, "Не длиннее 120 символов"),
    category_id: z.string(),
    description: z.string().trim(),
    ingredients: z.string().trim(),
    price: z.string().superRefine((raw, ctx) => {
      const r = parseNumber(raw, PRICE);
      if ("error" in r) ctx.addIssue({ code: "custom", message: r.error });
      else if (r.value === null) ctx.addIssue({ code: "custom", message: "Введите цену (0 — бесплатно)" });
    }),
    portion_grams: optionalNumber(PORTION),
    kcal_per_portion: optionalNumber(NUTRIENT),
    protein_per_portion: optionalNumber(NUTRIENT),
    fat_per_portion: optionalNumber(NUTRIENT),
    carbs_per_portion: optionalNumber(NUTRIENT),
    allergenMode: z.enum(["unset", "none", "list"]),
    allergenTags: z.array(z.string()),
    photo_url: z
      .string()
      .trim()
      .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Ссылка должна начинаться с http:// или https://"),
    is_published: z.boolean(),
    is_available: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.allergenMode === "list" && v.allergenTags.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["allergenTags"],
        message: "Добавьте аллерген или выберите «Аллергенов нет»",
      });
    }
  });

export type DishFormValues = z.infer<typeof dishSchema>;

/** Новое блюдо: черновик (не опубликовано), в наличии, аллергены не указаны. */
export const EMPTY_DISH: DishFormValues = {
  name: "",
  category_id: NO_CATEGORY,
  description: "",
  ingredients: "",
  price: "",
  portion_grams: "",
  kcal_per_portion: "",
  protein_per_portion: "",
  fat_per_portion: "",
  carbs_per_portion: "",
  allergenMode: "unset",
  allergenTags: [],
  photo_url: "",
  is_published: false,
  is_available: true,
};

/** Поля menu_items, которые пишет админка (валюты у блюда нет — она свойство ресторана). */
export interface DishPayload {
  name: string;
  category_id: string | null;
  description: string | null;
  ingredients: string | null;
  price: number;
  portion_grams: number | null;
  kcal_per_portion: number | null;
  protein_per_portion: number | null;
  fat_per_portion: number | null;
  carbs_per_portion: number | null;
  allergens: string[] | null;
  photo_url: string | null;
  is_published: boolean;
  is_available: boolean;
}

/** Строка menu_items (нужные поля). */
export interface DishRecord {
  name: string;
  category_id: string | null;
  description: string | null;
  ingredients: string | null;
  price: number;
  portion_grams: number | null;
  kcal_per_portion: number | null;
  protein_per_portion: number | null;
  fat_per_portion: number | null;
  carbs_per_portion: number | null;
  allergens: string[] | null;
  photo_url: string | null;
  is_published: boolean;
  is_available: boolean;
}

const text = (v: string | null) => v ?? "";
// null → пустое поле; 0 → «0». Через `?? ""`, а не через `|| ""`: ноль не должен пропадать.
const num = (v: number | null) => (v === null ? "" : String(v));

export function toFormValues(d: DishRecord): DishFormValues {
  return {
    name: d.name,
    category_id: d.category_id ?? NO_CATEGORY,
    description: text(d.description),
    ingredients: text(d.ingredients),
    price: String(d.price),
    portion_grams: num(d.portion_grams),
    kcal_per_portion: num(d.kcal_per_portion),
    protein_per_portion: num(d.protein_per_portion),
    fat_per_portion: num(d.fat_per_portion),
    carbs_per_portion: num(d.carbs_per_portion),
    // null = «не указано», [] = «указано: аллергенов нет», иначе список.
    allergenMode: d.allergens === null ? "unset" : d.allergens.length === 0 ? "none" : "list",
    allergenTags: d.allergens ?? [],
    photo_url: text(d.photo_url),
    is_published: d.is_published,
    is_available: d.is_available,
  };
}

const emptyToNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

function numberOrNull(raw: string, rule: NumberRule): number | null {
  const r = parseNumber(raw, rule);
  return "value" in r ? r.value : null;
}

/** Значения формы (прошедшие схему) → строка для insert/update. */
export function toDishPayload(v: DishFormValues): DishPayload {
  return {
    name: v.name.trim(),
    category_id: v.category_id === NO_CATEGORY ? null : v.category_id,
    description: emptyToNull(v.description),
    ingredients: emptyToNull(v.ingredients),
    price: numberOrNull(v.price, PRICE) ?? 0,
    portion_grams: numberOrNull(v.portion_grams, PORTION),
    kcal_per_portion: numberOrNull(v.kcal_per_portion, NUTRIENT),
    protein_per_portion: numberOrNull(v.protein_per_portion, NUTRIENT),
    fat_per_portion: numberOrNull(v.fat_per_portion, NUTRIENT),
    carbs_per_portion: numberOrNull(v.carbs_per_portion, NUTRIENT),
    allergens: v.allergenMode === "unset" ? null : v.allergenMode === "none" ? [] : v.allergenTags,
    photo_url: emptyToNull(v.photo_url),
    is_published: v.is_published,
    is_available: v.is_available,
  };
}

/** Хоть одно из четырёх значений КБЖУ не указано — гость получит «нет данных». */
export function lacksNutrition(d: Pick<DishRecord, "kcal_per_portion" | "protein_per_portion" | "fat_per_portion" | "carbs_per_portion">): boolean {
  return (
    d.kcal_per_portion === null ||
    d.protein_per_portion === null ||
    d.fat_per_portion === null ||
    d.carbs_per_portion === null
  );
}

/**
 * Добавление аллергена-тега: trim, пустые и точные дубли игнорируются.
 * Регистр не меняем («Орехи» и «орехи» — разные теги, решать менеджеру).
 */
export function addTag(tags: readonly string[], input: string): string[] {
  const tag = input.trim();
  if (tag === "" || tags.includes(tag)) return [...tags];
  return [...tags, tag];
}

export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}

/** Лимит бота: на экране категории помещается 10 блюд (STATE §2), остальные — поиском. */
export const BOT_CATEGORY_LIMIT = 10;
