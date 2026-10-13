import type { MenuItemRow } from "../types.ts";
import { formatPrice } from "./formatPrice.ts";
import { NO_DATA, valueOrNoData } from "./formatRestaurantInfo.ts";

// Валюта не колонка блюда, а свойство ресторана: сервис подмешивает её к строке блюда.
export type DishCardData =
  & Pick<
    MenuItemRow,
    | "name" | "description" | "price" | "ingredients" | "allergens" | "portion_grams"
    | "kcal_per_portion" | "protein_per_portion" | "fat_per_portion" | "carbs_per_portion" | "is_available"
  >
  & { currency: string };

export const UNAVAILABLE_LABEL = "⏸ Сейчас недоступно";

// Отсутствие аллергена в карточке — не гарантия безопасности, поэтому предупреждение стоит на каждой карточке.
export const ALLERGY_WARNING =
  "⚠️ При аллергии уточните состав у персонала: данные в карточке могут быть неполными.";

/** 420.0 → «420», 5.5 → «5,5». */
function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

// Ноль — это значение (0 г углеводов), «нет данных» только для null. Поэтому сравниваем с null, а не по truthy.
function nutrientOrDash(value: number | null): string {
  return value === null ? "—" : formatNumber(value);
}

function formatNutrition(item: DishCardData): string {
  const { kcal_per_portion: kcal, protein_per_portion: p, fat_per_portion: f, carbs_per_portion: c } = item;
  if (kcal === null && p === null && f === null && c === null) return NO_DATA;
  return `${nutrientOrDash(kcal)} ккал · Б ${nutrientOrDash(p)} · Ж ${nutrientOrDash(f)} · У ${nutrientOrDash(c)}`;
}

function formatAllergens(allergens: string[] | null): string {
  if (allergens === null) return NO_DATA;
  if (allergens.length === 0) return "нет (по данным карточки)";
  return allergens.join(", ");
}

export function formatDishCard(item: DishCardData): string {
  const lines: string[] = [];
  if (!item.is_available) lines.push(UNAVAILABLE_LABEL);
  lines.push(`${item.name} — ${formatPrice(item.price, item.currency)}`);
  if (item.description && item.description.trim() !== "") lines.push(item.description);
  lines.push(
    "",
    `Состав: ${valueOrNoData(item.ingredients)}`,
    `Аллергены: ${formatAllergens(item.allergens)}`,
    `Порция: ${item.portion_grams === null ? NO_DATA : `${item.portion_grams} г`}`,
    `КБЖУ на порцию: ${formatNutrition(item)}`,
    "",
    ALLERGY_WARNING,
  );
  return lines.join("\n");
}
