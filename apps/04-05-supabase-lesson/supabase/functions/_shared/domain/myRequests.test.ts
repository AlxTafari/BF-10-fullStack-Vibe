import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  canCancelBooking,
  canChangeBooking,
  formatBookingCard,
  formatBookingShort,
  formatGuestRequestLine,
  type MyBooking,
} from "./myRequests.ts";

const NOW = new Date("2026-10-13T12:00:00Z");
const booking = (over: Partial<MyBooking> = {}): MyBooking => ({
  id: "b1",
  guest_name: "Анна",
  contact: "@anna_k",
  booking_at: "2026-10-20T16:00:00Z", // 19:00 в Афинах
  guests_count: 4,
  comment: null,
  status: "pending",
  replaces_id: null,
  ...over,
});

Deno.test("отменить и изменить можно живую будущую бронь", () => {
  for (const status of ["pending", "confirmed"] as const) {
    assertEquals(canCancelBooking(booking({ status }), NOW), true);
    assertEquals(canChangeBooking(booking({ status }), false, NOW), true);
  }
});

Deno.test("нельзя: отменённая, отклонённая, прошедшая", () => {
  for (const status of ["declined", "cancelled"] as const) {
    assertEquals(canCancelBooking(booking({ status }), NOW), false);
    assertEquals(canChangeBooking(booking({ status }), false, NOW), false);
  }
  const past = booking({ booking_at: "2026-10-12T16:00:00Z" });
  assertEquals(canCancelBooking(past, NOW), false);
  assertEquals(canChangeBooking(past, false, NOW), false);
});

Deno.test("изменить нельзя: уже есть ожидающее изменение или это само изменение; отменить изменение можно", () => {
  assertEquals(canChangeBooking(booking(), true, NOW), false);
  const change = booking({ replaces_id: "b0" });
  assertEquals(canChangeBooking(change, false, NOW), false);
  assertEquals(canCancelBooking(change, NOW), true);
});

Deno.test("строка списка: время в поясе ресторана и статус словами", () => {
  const line = formatBookingShort(booking(), "Europe/Athens");
  assertStringIncludes(line, "вт, 20.10 19:00");
  assertStringIncludes(line, "4 гост.");
  assertStringIncludes(line, "ожидает подтверждения");
});

Deno.test("статус не обещает лишнего: pending ≠ «подтверждена»", () => {
  const card = formatBookingCard(booking(), "Europe/Athens", null);
  assertEquals(/подтверждена/i.test(card), false);
  assertStringIncludes(formatBookingCard(booking({ status: "confirmed" }), "Europe/Athens", null), "подтверждена менеджером");
});

Deno.test("карточка показывает ожидающее изменение и что действует прежняя бронь", () => {
  const card = formatBookingCard(booking(), "Europe/Athens", booking({ id: "b2", replaces_id: "b1", booking_at: "2026-10-21T17:00:00Z", guests_count: 5 }));
  assertStringIncludes(card, "Запрошено изменение: 21.10.2026 20:00, гостей: 5");
  assertStringIncludes(card, "действует эта бронь");
});

Deno.test("обращение: длинный текст обрезается", () => {
  const line = formatGuestRequestLine({ kind: "complaint", text: "а".repeat(80), status: "new" });
  assertStringIncludes(line, "Жалоба");
  assertStringIncludes(line, "…");
  assertStringIncludes(line, "получено");
});
