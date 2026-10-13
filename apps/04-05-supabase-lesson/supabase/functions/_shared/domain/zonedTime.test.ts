import { assertEquals } from "jsr:@std/assert@1";
import {
  addDays,
  diffDays,
  formatLocalDateTime,
  isoWeekday,
  isValidDateString,
  localNow,
  zonedDateTimeToUtc,
} from "./zonedTime.ts";

const ATHENS = "Europe/Athens";
const utc = (date: string, time: string) => zonedDateTimeToUtc(date, time, ATHENS)?.toISOString() ?? null;

Deno.test("летом Афины = UTC+3", () => {
  assertEquals(utc("2026-07-10", "19:00"), "2026-07-10T16:00:00.000Z");
});

Deno.test("зимой Афины = UTC+2", () => {
  assertEquals(utc("2026-12-10", "19:00"), "2026-12-10T17:00:00.000Z");
});

Deno.test("весенний перевод (29.03.2026): до и после пропущенного часа", () => {
  assertEquals(utc("2026-03-29", "02:30"), "2026-03-29T00:30:00.000Z"); // ещё +2
  assertEquals(utc("2026-03-29", "04:00"), "2026-03-29T01:00:00.000Z"); // уже +3
});

Deno.test("несуществующее время (03:30 при переводе вперёд) → null", () => {
  assertEquals(utc("2026-03-29", "03:30"), null);
});

Deno.test("осенний перевод (25.10.2026): двойное время → более ранний момент", () => {
  assertEquals(utc("2026-10-25", "03:30"), "2026-10-25T00:30:00.000Z"); // летнее, +3
  assertEquals(utc("2026-10-25", "04:00"), "2026-10-25T02:00:00.000Z"); // зимнее, +2
});

Deno.test("мусор на входе → null", () => {
  assertEquals(utc("2026-02-30", "19:00"), null);
  assertEquals(utc("2026-10-20", "25:00"), null);
  assertEquals(utc("2026-10-20", "7pm"), null);
});

Deno.test("round-trip: UTC → локальные дата и время ресторана", () => {
  assertEquals(formatLocalDateTime(new Date("2026-10-20T16:00:00Z"), ATHENS), "20.10.2026 19:00");
  // 22:30 UTC летом — уже следующие сутки в Афинах.
  assertEquals(localNow(new Date("2026-07-10T22:30:00Z"), ATHENS), { date: "2026-07-11", minutes: 90 });
});

Deno.test("календарные хелперы", () => {
  assertEquals(isoWeekday("2026-10-13"), 2); // вторник
  assertEquals(isoWeekday("2026-10-18"), 7); // воскресенье
  assertEquals(addDays("2026-10-30", 3), "2026-11-02");
  assertEquals(diffDays("2026-10-13", "2026-12-12"), 60);
  assertEquals(isValidDateString("2026-02-29"), false);
  assertEquals(isValidDateString("2028-02-29"), true);
});
