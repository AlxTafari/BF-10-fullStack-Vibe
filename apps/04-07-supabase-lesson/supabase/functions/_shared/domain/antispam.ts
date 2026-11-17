// Антиспам гостевого входа (S06c): константы и чистые решения. БД и Telegram здесь не известны.

/** Не больше RATE_LIMIT_MAX сообщений за RATE_LIMIT_WINDOW_SECONDS от одного гостя (окно фиксированное, считает БД). */
export const RATE_LIMIT_MAX = 3;
export const RATE_LIMIT_WINDOW_SECONDS = 30;
/**
 * Нажатия кнопок — отдельное, широкое окно (S07): живой гость листает меню быстро, но 30 нажатий в минуту не набирает.
 * Лимит защищает от скрипта, долбящего кнопку, а не от гостя. Стартовое значение — правится здесь.
 */
export const BUTTON_RATE_MAX = 30;
export const BUTTON_RATE_WINDOW_SECONDS = 60;

/** Окно счётчика в rate_limits.bucket: текст вне сценария и нажатия кнопок считаются независимо. */
export type RateBucket = "text" | "button";

export const RATE_LIMITS: Record<RateBucket, { max: number; windowSeconds: number }> = {
  text: { max: RATE_LIMIT_MAX, windowSeconds: RATE_LIMIT_WINDOW_SECONDS },
  button: { max: BUTTON_RATE_MAX, windowSeconds: BUTTON_RATE_WINDOW_SECONDS },
};

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
 * Считать ли апдейт в ТЕКСТОВЫЙ лимит частоты («3 за 30 с»). Считаем только свободный текст вне сценария — то есть поиск
 * блюда: это единственный вход, где гость может завалить бота произвольными сообщениями. Не считаем:
 *  - команды (/start, /cancel) и нажатия кнопок меню/FAQ/категорий — навигация, гость листает разделы быстро, а лимит
 *    «3 за 30 с» упирался в него почти сразу; повторы экранов гасит антидубль (S06d). Кнопки идут в своё, широкое
 *    окно (bucket = 'button', S07) — его проверяет роутер отдельно;
 *  - всё внутри живого сценария брони/обращения (имя, контакт, число гостей, «дата → время → подтвердить»).
 */
export function countsTowardRateLimit(input: { isCommand: boolean; isCallback: boolean; hasLiveFlow: boolean }): boolean {
  return !input.isCommand && !input.isCallback && !input.hasLiveFlow;
}
