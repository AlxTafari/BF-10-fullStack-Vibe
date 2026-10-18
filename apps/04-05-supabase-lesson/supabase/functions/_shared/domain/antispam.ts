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
 * Считать ли апдейт в лимит частоты. Считаем только свободный текст вне сценария — то есть поиск блюда: это единственный
 * вход, где гость может завалить бота произвольными сообщениями. Не считаем:
 *  - команды (/start, /cancel) и нажатия кнопок меню/FAQ/категорий — навигация, гость листает разделы быстро, а лимит
 *    «3 за 30 с» упирался в него почти сразу; повторы экранов гасит антидубль (S06d);
 *  - всё внутри живого сценария брони/обращения (имя, контакт, число гостей, «дата → время → подтвердить»).
 */
export function countsTowardRateLimit(input: { isCommand: boolean; isCallback: boolean; hasLiveFlow: boolean }): boolean {
  return !input.isCommand && !input.isCallback && !input.hasLiveFlow;
}
