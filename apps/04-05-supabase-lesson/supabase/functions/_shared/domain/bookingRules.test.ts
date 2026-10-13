import { assertEquals } from "jsr:@std/assert@1";
import { availableDates, availableHours, availablePeriods, type BookingEnv, validateSlot } from "./bookingRules.ts";

// Вт–Вс 13:00–24:00, понедельник выходной (как в seed).
const HOURS = Object.fromEntries(
  ["2", "3", "4", "5", "6", "7"].map((d) => [d, { open: "13:00", close: "24:00" }]),
);
// 2026-10-13 — вторник; 12:00 UTC = 15:00 в Афинах (летнее время).
const env = (over: Partial<BookingEnv> = {}): BookingEnv => ({
  now: new Date("2026-10-13T12:00:00Z"),
  timeZone: "Europe/Athens",
  openingHours: HOURS,
  ...over,
});

Deno.test("сегодня: часы не раньше «сейчас + 30 мин», обед режется часами работы", () => {
  // 15:00 + 30 мин = 15:30 → из обеда (13–16, но работаем с 13) остаётся только 16.
  assertEquals(availableHours("2026-10-13", "lunch", env()), [16]);
  assertEquals(availableHours("2026-10-13", "dinner", env()), [17, 18, 19, 20, 21, 22]);
});

Deno.test("другой день: обед начинается с открытия, а не с 12:00", () => {
  assertEquals(availableHours("2026-10-14", "lunch", env()), [13, 14, 15, 16]);
});

Deno.test("поздно вечером сегодня периодов нет", () => {
  const late = env({ now: new Date("2026-10-13T19:30:00Z") }); // 22:30 в Афинах
  assertEquals(availablePeriods("2026-10-13", late), []);
});

Deno.test("выходной день: ни периодов, ни даты в списке", () => {
  assertEquals(availablePeriods("2026-10-19", env()), []);
  const dates = availableDates(env());
  assertEquals(dates.includes("2026-10-19"), false);
  assertEquals(dates[0], "2026-10-13");
  assertEquals(dates.length, 12); // 13–26 октября: 14 дней минус два понедельника (19-е и 26-е)
});

Deno.test("«сегодня» по часовому поясу ресторана, а не UTC", () => {
  // 22:30 UTC 13.10 = 01:30 14.10 в Афинах → сегодня уже среда.
  const e = env({ now: new Date("2026-10-13T22:30:00Z") });
  assertEquals(availableDates(e)[0], "2026-10-14");
});

Deno.test("часы неизвестны (null) — ограничения только периоды", () => {
  assertEquals(availableHours("2026-10-19", "lunch", env({ openingHours: null })), [12, 13, 14, 15, 16]);
});

Deno.test("битые часы в БД = закрыто", () => {
  assertEquals(availablePeriods("2026-10-14", env({ openingHours: { "3": { open: "abc", close: "24:00" } } })), []);
});

Deno.test("validateSlot: допустимый слот", () => {
  assertEquals(validateSlot("2026-10-20", "19:00", env()), { ok: true });
});

Deno.test("validateSlot: отказы", () => {
  assertEquals(validateSlot("2026-10-12", "19:00", env()), { ok: false, error: "date_in_past" });
  assertEquals(validateSlot("2026-12-20", "19:00", env()), { ok: false, error: "date_too_far" });
  assertEquals(validateSlot("2026-10-14", "19:30", env()), { ok: false, error: "bad_time" });
  assertEquals(validateSlot("2026-10-14", "04:00", env()), { ok: false, error: "bad_time" });
  assertEquals(validateSlot("2026-10-19", "19:00", env()), { ok: false, error: "closed" });
  assertEquals(validateSlot("2026-10-13", "15:00", env()), { ok: false, error: "too_soon" });
  assertEquals(validateSlot("2026-02-30", "19:00", env()), { ok: false, error: "bad_date" });
});

Deno.test("граница 60 дней включительно", () => {
  // 2026-12-12 = ровно через 60 дней, суббота.
  assertEquals(validateSlot("2026-12-12", "19:00", env()), { ok: true });
  assertEquals(validateSlot("2026-12-13", "19:00", env()), { ok: false, error: "date_too_far" });
});
