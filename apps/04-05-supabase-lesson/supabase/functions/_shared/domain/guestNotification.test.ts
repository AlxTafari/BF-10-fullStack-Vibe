import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { formatBookingDecision, isBookingDecision } from "./guestNotification.ts";

// 16:00 UTC в Салониках (EET/EEST, октябрь = UTC+3) → 19:00
const base = { booking_at: "2026-10-20T16:00:00+00:00", guests_count: 4, isChange: false };
const TZ = "Europe/Athens";

Deno.test("pending — не решение, сообщения нет", () => {
  assertEquals(isBookingDecision("pending"), false);
  assertEquals(formatBookingDecision({ ...base, status: "pending" }, TZ), null);
});

Deno.test("подтверждена: время в поясе ресторана и число гостей", () => {
  const text = formatBookingDecision({ ...base, status: "confirmed" }, TZ)!;
  assertStringIncludes(text, "подтверждена");
  assertStringIncludes(text, "20.10.2026 19:00");
  assertStringIncludes(text, "Гостей: 4");
});

Deno.test("отклонена и отменена: тексты разные и не называют бронь подтверждённой", () => {
  const declined = formatBookingDecision({ ...base, status: "declined" }, TZ)!;
  const cancelled = formatBookingDecision({ ...base, status: "cancelled" }, TZ)!;
  assertEquals(declined === cancelled, false);
  for (const text of [declined, cancelled]) assertEquals(/подтверждена/i.test(text), false);
});

Deno.test("запрос на изменение: говорит про изменение и судьбу прежней брони", () => {
  const confirmed = formatBookingDecision({ ...base, status: "confirmed", isChange: true }, TZ)!;
  assertStringIncludes(confirmed, "Изменение брони подтверждено");
  assertStringIncludes(confirmed, "Прежняя бронь отменена");

  for (const status of ["declined", "cancelled"] as const) {
    const text = formatBookingDecision({ ...base, status, isChange: true }, TZ)!;
    assertStringIncludes(text, "Прежняя бронь остаётся в силе");
  }
});
