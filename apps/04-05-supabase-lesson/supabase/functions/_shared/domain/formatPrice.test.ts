import { assertEquals } from "jsr:@std/assert@1";
import { formatPrice } from "./formatPrice.ts";

// Intl ставит неразрывный пробел перед символом валюты — для сравнения приводим к обычному.
const plain = (s: string) => s.replace(/ /g, " ");

Deno.test("форматирует цену в евро с запятой", () => {
  assertEquals(plain(formatPrice(6.5, "EUR")), "6,50 €");
});

Deno.test("неизвестная валюта не бросает исключение", () => {
  assertEquals(formatPrice(6.5, "ЕВРО"), "6.50 ЕВРО");
});
