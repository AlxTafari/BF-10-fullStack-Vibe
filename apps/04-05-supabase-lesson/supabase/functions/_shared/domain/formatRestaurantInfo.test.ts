import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { formatRestaurantInfo, NO_DATA } from "./formatRestaurantInfo.ts";

const full = {
  name: "Ресторан Лавраки",
  description: "Домашняя кухня.",
  address: "ул. Речная, 12",
  phone: "+7 900 000-00-00",
  working_hours: "12:00–23:00",
};

Deno.test("форматирует заполненную карточку", () => {
  const text = formatRestaurantInfo(full);
  assertStringIncludes(text, "ул. Речная, 12");
  assertStringIncludes(text, "12:00–23:00");
});

Deno.test("null и пустые строки заменяются на «нет данных», а не выдумываются", () => {
  const text = formatRestaurantInfo({ ...full, address: null, phone: "   " });
  assertEquals(text.split(NO_DATA).length - 1, 2);
});

Deno.test("пустое описание не оставляет пустую строку после названия", () => {
  const text = formatRestaurantInfo({ ...full, description: null });
  assertEquals(text.split("\n")[0], "Ресторан Лавраки");
  assertEquals(text.split("\n")[1], "");
});
