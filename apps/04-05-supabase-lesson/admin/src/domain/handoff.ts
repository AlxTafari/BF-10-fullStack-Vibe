// Менеджер в диалоге (S06b): ручной режим и тексты результата для менеджера. Чистые функции: без React и сети.

/** Ручной режим идёт, пока метка в будущем. Тайм-аут ленивый: истёкшая метка просто перестаёт действовать. */
export function isHandoffActive(handoffUntil: string | null, nowMs: number): boolean {
  if (!handoffUntil) return false;
  const until = Date.parse(handoffUntil);
  return Number.isFinite(until) && until > nowMs;
}

/** Предел текста — как в Edge Function manager-chat (у Telegram 4096, запас на подпись). */
export const MANAGER_REPLY_MAX_LENGTH = 4000;
/** С какого числа символов показывать счётчик под полем. */
export const MANAGER_REPLY_COUNTER_FROM = 3500;

/** Итог доставки гостю, как его отдаёт функция. skipped — уведомление не требовалось (повторное подключение). */
export type Delivery = "sent" | "blocked" | "failed" | "skipped";

/** Коды ошибок функции manager-chat (тело ответа { error }). */
export type ManagerChatErrorCode = "not_found" | "handoff_inactive" | "invalid_text" | "unauthorized" | "internal";

/** Ошибка доставки ответа — текст под полем ввода. null — доставлено. */
export function deliveryError(delivery: Delivery): string | null {
  switch (delivery) {
    case "blocked":
      return "Не доставлено: гость заблокировал бота";
    case "failed":
      return "Не доставлено: ошибка Telegram, попробуйте ещё раз";
    default:
      return null;
  }
}

/** Уведомление о подключении не дошло — режим всё равно включён, менеджеру об этом надо знать. */
export function joinWarning(delivery: Delivery): string | null {
  switch (delivery) {
    case "blocked":
      return "Гость не получит сообщения: он заблокировал бота";
    case "failed":
      return "Уведомление о подключении не дошло (ошибка Telegram)";
    default:
      return null;
  }
}

/** Код ошибки функции → текст для менеджера. */
export function managerChatErrorText(code: string | undefined): string {
  switch (code) {
    case "handoff_inactive":
      return "Подключение истекло — подключитесь снова";
    case "invalid_text":
      return `Сообщение пустое или длиннее ${MANAGER_REPLY_MAX_LENGTH} символов`;
    case "not_found":
      return "Диалог не найден";
    case "unauthorized":
      return "Сессия истекла — войдите снова";
    default:
      return "Не удалось выполнить, попробуйте ещё раз";
  }
}
