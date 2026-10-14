// Статусы брони и матрица переходов. Дублирует SQL-функцию set_booking_status осознанно (два рантайма):
// интерфейс не предлагает невозможного, а последнее слово всё равно за RPC. Согласованность держит тест
// tests/status-rpc.integration.test.ts (там своя копия матрицы, сверяемая с БД).

export const BOOKING_STATUSES = ["pending", "confirmed", "declined", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Ожидает",
  confirmed: "Подтверждена",
  declined: "Отклонена",
  cancelled: "Отменена",
};

/** Все переходы, которые разрешает БД. declined и cancelled — финальные. */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ["confirmed", "declined", "cancelled"],
  confirmed: ["cancelled"],
  declined: [],
  cancelled: [],
};

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

/** Время брони уже прошло. Граница та же, что в БД: `booking_at < now()`. */
export function isPastDue(bookingAt: string, now: Date): boolean {
  return Date.parse(bookingAt) < now.getTime();
}

export interface BookingActionInput {
  status: BookingStatus;
  booking_at: string;
  /** Заявка — запрос на изменение существующей брони. */
  replaces_id: string | null;
}

export interface BookingAction {
  to: BookingStatus;
  label: string;
  /** Нужен подтверждающий диалог. */
  needsConfirm: boolean;
  /** Почему действие недоступно (null — доступно). Кнопка показывается, но заблокирована, с подсказкой. */
  disabledReason: string | null;
}

/**
 * Кнопки карточки. Предлагаем не все переходы матрицы, а те, что нужны менеджеру:
 * у ожидающей — подтвердить / отклонить (закрыть без ответа — через «Отклонить»), у подтверждённой — отменить.
 */
export function allowedBookingActions(booking: BookingActionInput, now: Date): BookingAction[] {
  const isChange = booking.replaces_id !== null;
  switch (booking.status) {
    case "pending":
      return [
        {
          to: "confirmed",
          label: isChange ? "Подтвердить изменение" : "Подтвердить",
          needsConfirm: isChange, // подтверждение изменения отменяет исходную бронь — предупреждаем
          disabledReason: isPastDue(booking.booking_at, now) ? "Время брони уже прошло — подтвердить нельзя" : null,
        },
        { to: "declined", label: "Отклонить", needsConfirm: true, disabledReason: null },
      ];
    case "confirmed":
      return [{ to: "cancelled", label: "Отменить бронь", needsConfirm: true, disabledReason: null }];
    case "declined":
    case "cancelled":
      return [];
  }
}
