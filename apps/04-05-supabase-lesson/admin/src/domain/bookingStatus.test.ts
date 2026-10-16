import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  type BookingActionInput,
  allowedBookingActions,
  guestNotificationFailed,
  isBookingStatus,
  isPastDue,
  managerNotificationFailed,
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

describe("метки недоставленных уведомлений", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const old = "2026-10-20T11:50:00Z";
  const fresh = "2026-10-20T11:59:30Z";

  it("менеджер: пусто и старше минуты — сбой; свежее — задержка; есть отметка — всё хорошо", () => {
    expect(managerNotificationFailed({ manager_notified_at: null, created_at: old }, now)).toBe(true);
    expect(managerNotificationFailed({ manager_notified_at: null, created_at: fresh }, now)).toBe(false);
    expect(managerNotificationFailed({ manager_notified_at: old, created_at: old }, now)).toBe(false);
  });

  const base = { status: "confirmed" as const, conversation_id: "c", guest_notified_at: null, updated_at: old, booking_at: future };
  it("гость: confirmed/declined без отметки дольше минуты — сбой", () => {
    expect(guestNotificationFailed(base, now)).toBe(true);
    expect(guestNotificationFailed({ ...base, status: "declined" }, now)).toBe(true);
  });
  it("гость: свежее решение, есть отметка, нет диалога — не сбой", () => {
    expect(guestNotificationFailed({ ...base, updated_at: fresh }, now)).toBe(false);
    expect(guestNotificationFailed({ ...base, guest_notified_at: old }, now)).toBe(false);
    expect(guestNotificationFailed({ ...base, conversation_id: null }, now)).toBe(false);
  });
  it("гость: время брони прошло — гостю намеренно не писали, не сбой", () => {
    expect(guestNotificationFailed({ ...base, booking_at: old }, now)).toBe(false);
    expect(guestNotificationFailed({ ...base, status: "declined", booking_at: old }, now)).toBe(false);
  });
  it("гость: cancelled и pending метку не получают (отмену мог сделать сам гость)", () => {
    expect(guestNotificationFailed({ ...base, status: "cancelled" }, now)).toBe(false);
    expect(guestNotificationFailed({ ...base, status: "pending" }, now)).toBe(false);
  });
});
