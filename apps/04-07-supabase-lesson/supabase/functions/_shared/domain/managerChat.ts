// Менеджер в диалоге (S06b): ручной режим и проверка ответа. Чистые функции: без БД и без Telegram.

/**
 * Ручной режим идёт, пока метка handoff_until в будущем. Тайм-аут ленивый: фоновой задачи нет, истёкшая метка
 * просто перестаёт действовать. Нечитаемая метка = режима нет: бот лучше ответит лишний раз, чем замолчит навсегда.
 */
export function isHandoffActive(handoffUntil: string | null | undefined, now: Date): boolean {
  if (!handoffUntil) return false;
  const until = Date.parse(handoffUntil);
  return Number.isFinite(until) && until > now.getTime();
}

/** Предел текста менеджера: у Telegram 4096 символов, запас на подпись «👤 Менеджер ресторана». */
export const MANAGER_REPLY_MAX_LENGTH = 4000;

export type ManagerTextCheck = { ok: true; text: string } | { ok: false };

/** Текст ответа: обрезаем края; пустой или длиннее предела — отказ (длинный не режем: менеджер увидит и сократит). */
export function checkManagerText(raw: unknown): ManagerTextCheck {
  if (typeof raw !== "string") return { ok: false };
  const text = raw.trim();
  if (!text || text.length > MANAGER_REPLY_MAX_LENGTH) return { ok: false };
  return { ok: true, text };
}
