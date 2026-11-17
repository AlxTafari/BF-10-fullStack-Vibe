// Справочник 14 аллергенов ЕС (Регламент 1169/2011, приложение II).
// Тот же список — в БД (eu_allergen_codes(), check на menu_items.allergens) и в admin/src/domain/allergens.ts.
// Порядок — как в приложении II; в нём же выводим аллергены гостю.
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

// Подписи для гостя. Record по AllergenCode: новый код без подписи не скомпилируется.
export const ALLERGEN_LABELS: Record<AllergenCode, string> = {
  cereals_gluten: "глютен (злаки)",
  crustaceans: "ракообразные",
  eggs: "яйца",
  fish: "рыба",
  peanuts: "арахис",
  soybeans: "соя",
  milk: "молоко",
  nuts: "орехи",
  celery: "сельдерей",
  mustard: "горчица",
  sesame: "кунжут",
  sulphites: "сульфиты",
  lupin: "люпин",
  molluscs: "моллюски",
};

export function isAllergenCode(value: string): value is AllergenCode {
  return (EU_ALLERGEN_CODES as readonly string[]).includes(value);
}

/**
 * Подпись аллергена для гостя. Неизвестный код (check в БД такого не пропустит, но строка пришла
 * извне) показываем как есть: скрыть аллерген из карточки опаснее, чем показать технический код.
 */
export function allergenLabel(code: string): string {
  return isAllergenCode(code) ? ALLERGEN_LABELS[code] : code;
}

/** Три группы ответа на «что мне можно при аллергии на …» (S09). */
export interface AllergenPartition<T> {
  /** Состав указан, и ни одного из названных аллергенов в нём нет. */
  free: T[];
  /** Содержит хотя бы один из названных аллергенов. */
  contains: T[];
  /** Состав не указан (allergens = null): безопасным назвать нельзя, только «уточните у персонала». */
  unknown: T[];
}

/**
 * Делит блюда по аллергенам гостя — детерминированно, без LLM: модель только пересказывает группы.
 * null ≠ []: [] — ресторан указал «аллергенов нет» (блюдо в free), null — не указал ничего (в unknown).
 */
export function partitionByAllergens<T extends { allergens: string[] | null }>(
  items: T[],
  avoid: readonly AllergenCode[],
): AllergenPartition<T> {
  const result: AllergenPartition<T> = { free: [], contains: [], unknown: [] };
  for (const item of items) {
    if (item.allergens === null) result.unknown.push(item);
    else if (item.allergens.some((code) => (avoid as readonly string[]).includes(code))) result.contains.push(item);
    else result.free.push(item);
  }
  return result;
}
