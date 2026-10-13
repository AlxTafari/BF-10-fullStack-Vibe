import { assertEquals } from "jsr:@std/assert@1";
import {
  validateComment,
  validateContact,
  validateGuests,
  validateName,
  validateRequestText,
} from "./fieldValidation.ts";

Deno.test("гости: 1–20, только целые", () => {
  assertEquals(validateGuests("4"), { ok: true, value: 4 });
  assertEquals(validateGuests(" 20 "), { ok: true, value: 20 });
  assertEquals(validateGuests("0"), { ok: false, error: "guests_too_few" });
  assertEquals(validateGuests("21"), { ok: false, error: "guests_too_many" });
  assertEquals(validateGuests("100"), { ok: false, error: "guests_too_many" });
  assertEquals(validateGuests("4.5"), { ok: false, error: "guests_not_integer" });
  assertEquals(validateGuests("-3"), { ok: false, error: "guests_not_integer" });
  assertEquals(validateGuests("четверо"), { ok: false, error: "guests_not_integer" });
  assertEquals(validateGuests(4), { ok: true, value: 4 });
});

Deno.test("имя: 2–60 символов после trim", () => {
  assertEquals(validateName("  Анна "), { ok: true, value: "Анна" });
  assertEquals(validateName("А"), { ok: false, error: "name_too_short" });
  assertEquals(validateName("   "), { ok: false, error: "name_too_short" });
  assertEquals(validateName("я".repeat(61)), { ok: false, error: "name_too_long" });
});

Deno.test("контакт: телефон нормализуется, @username проверяется", () => {
  assertEquals(validateContact("+30 (231) 000-00-00"), { ok: true, value: "+302310000000" });
  assertEquals(validateContact("8 912 345 67 89"), { ok: true, value: "89123456789" });
  assertEquals(validateContact("@anna_k"), { ok: true, value: "@anna_k" });
  assertEquals(validateContact("абв"), { ok: false, error: "contact_invalid" });
  assertEquals(validateContact("12345"), { ok: false, error: "contact_invalid" }); // 5 цифр
  assertEquals(validateContact("1".repeat(16)), { ok: false, error: "contact_invalid" });
  assertEquals(validateContact("@abc"), { ok: false, error: "contact_invalid" }); // короче 5
  assertEquals(validateContact("@" + "a".repeat(33)), { ok: false, error: "contact_invalid" });
  assertEquals(validateContact("+30abc2310000"), { ok: false, error: "contact_invalid" });
});

Deno.test("комментарий: пустой → null, длинный отклоняется", () => {
  assertEquals(validateComment("  "), { ok: true, value: null });
  assertEquals(validateComment(" у окна "), { ok: true, value: "у окна" });
  assertEquals(validateComment("а".repeat(501)), { ok: false, error: "comment_too_long" });
});

Deno.test("текст обращения: 1–2000", () => {
  assertEquals(validateRequestText(" ok "), { ok: true, value: "ok" });
  assertEquals(validateRequestText("  "), { ok: false, error: "text_empty" });
  assertEquals(validateRequestText("а".repeat(2001)), { ok: false, error: "text_too_long" });
});
