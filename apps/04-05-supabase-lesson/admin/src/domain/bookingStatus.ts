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

// ---------------------------------------------------------------- метки «уведомление не доставлено»

/** Меньше этого срока отсутствие отметки — нормальная задержка отправки, а не сбой. */
export const NOTIFY_GRACE_MS = 60_000;

const olderThanGrace = (iso: string, now: Date) => now.getTime() - Date.parse(iso) > NOTIFY_GRACE_MS;

/**
 * Менеджер мог не получить уведомление о новой заявке в Telegram (manager_notified_at пуст дольше минуты).
 * Обычно причина — не задан или неверен manager_chat_id.
 */
export function managerNotificationFailed(r: { manager_notified_at: string | null; created_at: string }, now: Date): boolean {
  return r.manager_notified_at === null && olderThanGrace(r.created_at, now);
}

/**
 * Гость не получил сообщение о решении (guest_notified_at пуст дольше минуты после смены статуса).
 * Только для confirmed / declined: их ставит исключительно менеджер. cancelled — не показываем: бронь мог отменить
 * сам гость через бота, а тогда уведомления нет и не должно быть.
 */
export function guestNotificationFailed(
  r: { status: BookingStatus; conversation_id: string | null; guest_notified_at: string | null; updated_at: string },
  now: Date,
): boolean {
  return (
    (r.status === "confirmed" || r.status === "declined") &&
    r.conversation_id !== null &&
    r.guest_notified_at === null &&
    olderThanGrace(r.updated_at, now)
  );
}
