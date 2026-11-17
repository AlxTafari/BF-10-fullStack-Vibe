import { describe, expect, it } from "vitest";
import {
  type BookingListRow,
  type GuestRequestListRow,
  bookingListSpec,
  bookingsSearchSchema,
  guestRequestListSpec,
  guestRequestsSearchSchema,
} from "./requestLists";

const NOW = new Date("2026-10-20T12:00:00Z");
const booking = (id: string, status: string, booking_at: string, updated_at = "2026-10-20T09:00:00Z"): BookingListRow => ({
  id,
  status,
  booking_at,
  updated_at,
});

describe("bookingsSearchSchema", () => {
  it("значения по умолчанию", () => {
    expect(bookingsSearchSchema.parse({})).toEqual({ tab: "pending", when: "upcoming", size: 20 });
  });
  it("неверные значения заменяются умолчаниями, верные сохраняются", () => {
    expect(bookingsSearchSchema.parse({ tab: "hacked", when: 5, size: "7" })).toEqual({
      tab: "pending",
      when: "upcoming",
      size: 20,
    });
    expect(bookingsSearchSchema.parse({ tab: "confirmed", when: "past", size: "50" })).toEqual({
      tab: "confirmed",
      when: "past",
      size: 50,
    });
  });
  it("размер страницы принимает число и строку: 20 / 50 / 100", () => {
    expect(bookingsSearchSchema.parse({ size: 100 }).size).toBe(100);
    expect(bookingsSearchSchema.parse({ size: "100" }).size).toBe(100);
    expect(bookingsSearchSchema.parse({ size: 30 }).size).toBe(20);
  });
});

describe("guestRequestsSearchSchema", () => {
  it("умолчания и починка неверных значений", () => {
    expect(guestRequestsSearchSchema.parse({})).toEqual({ tab: "new", kind: "all", size: 20 });
    expect(guestRequestsSearchSchema.parse({ tab: "x", kind: "y" })).toEqual({ tab: "new", kind: "all", size: 20 });
    expect(guestRequestsSearchSchema.parse({ tab: "resolved", kind: "complaint" })).toMatchObject({
      tab: "resolved",
      kind: "complaint",
    });
  });
});

describe("bookingListSpec", () => {
  const future = "2026-10-21T16:00:00Z";
  const past = "2026-10-19T16:00:00Z";

  it("«Ожидают»: только pending, ближайшие сверху (в том числе просроченные)", () => {
    const spec = bookingListSpec({ tab: "pending", when: "upcoming" }, NOW);
    const rows = [booking("a", "pending", future), booking("b", "pending", past)];
    expect(rows.filter(spec.matches).sort(spec.compare).map((r) => r.id)).toEqual(["b", "a"]);
    expect(spec.matches(booking("c", "confirmed", future))).toBe(false);
  });

  it("«Подтверждённые»: предстоящие по возрастанию, прошедшие по убыванию", () => {
    const upcoming = bookingListSpec({ tab: "confirmed", when: "upcoming" }, NOW);
    const earlier = booking("e", "confirmed", "2026-10-21T10:00:00Z");
    const later = booking("l", "confirmed", "2026-10-22T10:00:00Z");
    expect([later, earlier].sort(upcoming.compare).map((r) => r.id)).toEqual(["e", "l"]);
    expect(upcoming.matches(booking("p", "confirmed", past))).toBe(false);

    const archive = bookingListSpec({ tab: "confirmed", when: "past" }, NOW);
    const old = booking("o", "confirmed", "2026-10-01T10:00:00Z");
    const recent = booking("r", "confirmed", past);
    expect([old, recent].sort(archive.compare).map((r) => r.id)).toEqual(["r", "o"]);
    expect(archive.matches(booking("f", "confirmed", future))).toBe(false);
  });

  it("«Закрытые»: declined и cancelled, свежие по updated_at сверху", () => {
    const spec = bookingListSpec({ tab: "closed", when: "upcoming" }, NOW);
    const older = booking("o", "declined", future, "2026-10-20T08:00:00Z");
    const newer = booking("n", "cancelled", past, "2026-10-20T11:00:00Z");
    expect([older, newer].sort(spec.compare).map((r) => r.id)).toEqual(["n", "o"]);
    expect(spec.matches(booking("x", "confirmed", future))).toBe(false);
  });

  it("«Все»: всё, по времени брони от новых к старым", () => {
    const spec = bookingListSpec({ tab: "all", when: "upcoming" }, NOW);
    const rows = [booking("a", "pending", past), booking("b", "confirmed", future)];
    expect(rows.filter(spec.matches).sort(spec.compare).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("полный порядок: равное время разрешается по id", () => {
    const spec = bookingListSpec({ tab: "pending", when: "upcoming" }, NOW);
    const rows = [booking("b", "pending", future), booking("a", "pending", future)];
    expect(rows.sort(spec.compare).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("guestRequestListSpec", () => {
  const request = (id: string, status: string, kind: string, created_at: string): GuestRequestListRow => ({
    id,
    status,
    kind,
    created_at,
    updated_at: created_at,
  });

  it("вкладка по статусу, фильтр по типу, свежие сверху", () => {
    const spec = guestRequestListSpec({ tab: "new", kind: "complaint" });
    const rows = [
      request("a", "new", "complaint", "2026-10-20T09:00:00Z"),
      request("b", "new", "complaint", "2026-10-20T10:00:00Z"),
      request("c", "new", "feedback", "2026-10-20T11:00:00Z"),
      request("d", "resolved", "complaint", "2026-10-20T11:00:00Z"),
    ];
    expect(rows.filter(spec.matches).sort(spec.compare).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("«Все» по статусу и типу пропускает всё", () => {
    const spec = guestRequestListSpec({ tab: "all", kind: "all" });
    expect(spec.matches(request("a", "resolved", "feedback", "2026-10-20T09:00:00Z"))).toBe(true);
  });
});
