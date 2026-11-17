// Ошибки RPC смены статуса. БД кидает исключение с фиксированным текстом (error.message) — по нему выбираем
// сообщение для менеджера. Список общий для set_booking_status и set_guest_request_status.

export const RPC_ERROR_CODES = [
  "not_manager",
  "not_found",
  "status_conflict",
  "transition_not_allowed",
  "booking_in_past",
  "original_not_active",
] as const;
export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

const MESSAGES: Record<RpcErrorCode, string> = {
  not_manager: "Нет доступа к этой заявке",
  not_found: "Заявка не найдена",
  status_conflict: "Статус уже изменился — данные обновлены",
  transition_not_allowed: "Такой переход статуса недоступен",
  booking_in_past: "Время брони уже прошло — подтвердить нельзя",
  original_not_active: "Исходная бронь уже не действует — изменение подтвердить нельзя",
};

export const GENERIC_SAVE_ERROR = "Не удалось сохранить";

export function toRpcErrorCode(message: string | undefined): RpcErrorCode | null {
  return (RPC_ERROR_CODES as readonly string[]).includes(message ?? "") ? (message as RpcErrorCode) : null;
}

/** Текст для менеджера. Неизвестный текст ошибки (сеть, 500) не показываем «как есть» — общее сообщение. */
export function rpcErrorText(message: string | undefined): string {
  const code = toRpcErrorCode(message);
  return code ? MESSAGES[code] : GENERIC_SAVE_ERROR;
}
