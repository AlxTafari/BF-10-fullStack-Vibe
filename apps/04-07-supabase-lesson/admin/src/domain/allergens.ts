// Справочник 14 аллергенов ЕС (Регламент 1169/2011, приложение II).
// Тот же список — в БД (eu_allergen_codes(), check на menu_items.allergens) и в боте
// (supabase/functions/_shared/domain/allergens.ts). Общего модуля нет: админка и бот — разные сборки
// (Vite и Deno). Расхождение ловит БД: неизвестный код не сохранится; сверку держит rls.integration.test.ts.
export const EU_ALLERGEN_CODES = [
  "cereals_gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type AllergenCode = (typeof EU_ALLERGEN_CODES)[number];

// Подписи для менеджера: с примерами, чтобы было ясно, куда отнести конкретный продукт.
export const ALLERGEN_LABELS: Record<AllergenCode, string> = {
  cereals_gluten: "Глютен (пшеница, рожь, ячмень, овёс)",
  crustaceans: "Ракообразные (креветки, крабы)",
  eggs: "Яйца",
  fish: "Рыба",
  peanuts: "Арахис",
  soybeans: "Соя",
  milk: "Молоко и лактоза",
  nuts: "Орехи (миндаль, фундук, грецкий, кешью…)",
  celery: "Сельдерей",
  mustard: "Горчица",
  sesame: "Кунжут",
  sulphites: "Сульфиты (вино, сухофрукты)",
  lupin: "Люпин",
  molluscs: "Моллюски (мидии, кальмары, осьминоги)",
};

export function isAllergenCode(value: string): value is AllergenCode {
  return (EU_ALLERGEN_CODES as readonly string[]).includes(value);
}

/**
 * Отметить или снять аллерген. Результат — всегда в порядке справочника, без дублей:
 * порядок кликов не влияет на данные, а значит и на «есть ли изменения» в форме.
 */
export function toggleAllergen(selected: readonly AllergenCode[], code: AllergenCode, checked: boolean): AllergenCode[] {
  const next = new Set(selected);
  if (checked) next.add(code);
  else next.delete(code);
  return EU_ALLERGEN_CODES.filter((c) => next.has(c));
}
