import type { RestaurantRow } from "../types.ts";

// Поля, которые гость видит в карточке «О ресторане». Внутренние поля (id, timezone и т.п.) не отдаём.
export type RestaurantInfo = Pick<
  RestaurantRow,
  "name" | "description" | "address" | "phone" | "working_hours"
>;

export const NO_DATA = "нет данных — уточните у персонала";

/** Пустую или пробельную строку считаем отсутствием данных: бот не выдумывает и не оставляет пустых строк. */
function valueOrNoData(value: string | null): string {
  return value && value.trim() !== "" ? value : NO_DATA;
}

export function formatRestaurantInfo(info: RestaurantInfo): string {
  const lines = [info.name];
  if (info.description && info.description.trim() !== "") lines.push(info.description);
  lines.push(
    "",
    `📍 Адрес: ${valueOrNoData(info.address)}`,
    `🕒 Часы работы: ${valueOrNoData(info.working_hours)}`,
    `📞 Телефон: ${valueOrNoData(info.phone)}`,
  );
  return lines.join("\n");
}
