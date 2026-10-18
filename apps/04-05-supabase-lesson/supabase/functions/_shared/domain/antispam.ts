// Антиспам гостевого входа (S06c): константы и чистые решения. БД и Telegram здесь не известны.

/** Не больше RATE_LIMIT_MAX сообщений за RATE_LIMIT_WINDOW_SECONDS от одного гостя (окно фиксированное, считает БД). */
export const RATE_LIMIT_MAX = 3;
export const RATE_LIMIT_WINDOW_SECONDS = 30;
/** Лимит длины сообщения гостя в СИМВОЛАХ Unicode. */
export const MAX_GUEST_TEXT_LENGTH = 500;

/** Ответ check_rate_limit: пропустить, один раз предупредить или молча отбросить. */
export type RateDecision = "allowed" | "warn" | "drop";

/**
 * Длиннее лимита? Считаем кодовые точки, а не `.length`: эмодзи в JS — суррогатная пара (2 единицы UTF-16),
 * и «500 эмодзи» иначе превратились бы в «1000» и не прошли бы.
 */
export function isTooLong(text: string): boolean {
  // Быстрый путь: в UTF-16 кодовых точек не больше, чем единиц, — короткое точно проходит без разбора строки.
  if (text.length <= MAX_GUEST_TEXT_LENGTH) return false;
  return [...text].length > MAX_GUEST_TEXT_LENGTH;
}

/** Ответ БД → решение. Незнакомое значение (рассинхрон версий) трактуем как «пропустить»: антиспам не ломает бота. */
export function parseRateDecision(value: unknown): RateDecision {
  return value === "warn" || value === "drop" ? value : "allowed";
}

/**
 * Считать ли апдейт в лимит частоты. Не считаем то, что гость делает внутри живого сценария брони/обращения:
 * имя, контакт, число гостей, комментарий и нажатия «дата → время → подтвердить» — легитимные быстрые
 * шаги, 3 за 30 секунд там нормальны. Все остальные (меню, FAQ, поиск, свободный текст вне сценария) — считаем.
 */
export function countsTowardRateLimit(input: { isFlowCallback: boolean; hasLiveFlow: boolean }): boolean {
  return !input.isFlowCallback && !input.hasLiveFlow;
}
