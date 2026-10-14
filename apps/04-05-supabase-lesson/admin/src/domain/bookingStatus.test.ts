import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  type BookingActionInput,
  allowedBookingActions,
  isBookingStatus,
  isPastDue,
} from "./bookingStatus";

const NOW = new Date("2026-10-20T12:00:00Z");
const future = "2026-10-21T16:00:00Z";
const past = "2026-10-19T16:00:00Z";
const booking = (patch: Partial<BookingActionInput> = {}): BookingActionInput => ({
  status: "pending",
  booking_at: future,
  replaces_id: null,
  ...patch,
});

describe("isPastDue", () => {
  it("прошедшее время — да, будущее — нет", () => {
    expect(isPastDue(past, NOW)).toBe(true);
    expect(isPastDue(future, NOW)).toBe(false);
  });
  it("ровно сейчас — ещё не прошло (в БД строгое «<»)", () => {
    expect(isPastDue(NOW.toISOString(), NOW)).toBe(false);
  });
});

describe("isBookingStatus", () => {
  it("узнаёт только известные статусы", () => {
    expect(isBookingStatus("pending")).toBe(true);
    expect(isBookingStatus("done")).toBe(false);
  });
});

describe("allowedBookingActions", () => {
  it("pending: подтвердить и отклонить", () => {
    const actions = allowedBookingActions(booking(), NOW);
    expect(actions.map((a) => a.to)).toEqual(["confirmed", "declined"]);
    expect(actions[0]).toMatchObject({ label: "Подтвердить", needsConfirm: false, disabledReason: null });
    expect(actions[1]).toMatchObject({ label: "Отклонить", needsConfirm: true });
  });

  it("pending в прошлом: подтвердить заблокировано с причиной, отклонить доступно", () => {
    const [confirm, decline] = allowedBookingActions(booking({ booking_at: past }), NOW);
    expect(confirm?.disabledReason).toMatch(/прошло/);
    expect(decline?.disabledReason).toBeNull();
  });

  it("запрос на изменение: подтверждение требует диалога (отменит исходную бронь)", () => {
    const [confirm] = allowedBookingActions(booking({ replaces_id: "orig" }), NOW);
    expect(confirm).toMatchObject({ label: "Подтвердить изменение", needsConfirm: true });
  });

  it("confirmed: только отмена, с диалогом", () => {
    expect(allowedBookingActions(booking({ status: "confirmed" }), NOW)).toEqual([
      { to: "cancelled", label: "Отменить бронь", needsConfirm: true, disabledReason: null },
    ]);
  });

  it("финальные статусы — кнопок нет", () => {
    expect(allowedBookingActions(booking({ status: "declined" }), NOW)).toEqual([]);
    expect(allowedBookingActions(booking({ status: "cancelled" }), NOW)).toEqual([]);
  });

  it("каждое предлагаемое действие разрешено матрицей", () => {
    for (const status of BOOKING_STATUSES) {
      for (const action of allowedBookingActions(booking({ status }), NOW)) {
        expect(BOOKING_TRANSITIONS[status]).toContain(action.to);
      }
    }
  });
});
