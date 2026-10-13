import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  buildBookingSummary,
  buildGuestRequestSummary,
  formatBookingNotification,
  formatDate,
  formatGuestRequestNotification,
} from "./requestSummaries.ts";

Deno.test("дата с днём недели", () => {
  assertEquals(formatDate("2026-10-20"), "вт, 20.10.2026");
});

Deno.test("сводка брони: все поля, комментарий null → прочерк", () => {
  const s = buildBookingSummary({
    date: "2026-10-20",
    time: "19:00",
    guests: 4,
    name: "Анна",
    contact: "@anna_k",
    comment: null,
  });
  for (const part of ["вт, 20.10.2026", "19:00", "Гостей: 4", "Анна", "@anna_k", "Комментарий: —"]) {
    assertStringIncludes(s, part);
  }
});

Deno.test("в сводке нет слов, обещающих подтверждённую бронь", () => {
  const s = buildBookingSummary({ date: "2026-10-20", time: "19:00", guests: 2, name: "Анна", contact: "@anna_k", comment: null });
  assertEquals(/забронирован|подтвержд|столик ваш/i.test(s), false);
});

Deno.test("сводка обращения: контакт null → «не указан»", () => {
  const s = buildGuestRequestSummary({ kind: "complaint", text: "Долго ждали", contact: null });
  assertStringIncludes(s, "Жалоба");
  assertStringIncludes(s, "не указан");
});

Deno.test("уведомление менеджеру: время брони в поясе ресторана, id, статус ожидания", () => {
  const n = formatBookingNotification(
    {
      id: "abc",
      guest_name: "Анна",
      contact: "@anna_k",
      booking_at: "2026-10-20T16:00:00Z",
      guests_count: 4,
      comment: null,
      created_at: "2026-10-13T12:00:00Z",
    },
    "Europe/Athens",
  );
  assertStringIncludes(n, "20.10.2026 19:00");
  assertStringIncludes(n, "ожидает подтверждения");
  assertStringIncludes(n, "ID: abc");
  const g = formatGuestRequestNotification(
    { id: "g1", kind: "feedback", text: "Спасибо!", contact: null, created_at: "2026-10-13T12:00:00Z" },
    "Europe/Athens",
  );
  assertStringIncludes(g, "Отзыв");
});
