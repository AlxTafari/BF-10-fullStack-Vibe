// Форматирование моментов. Время заявок показываем в часовом поясе РЕСТОРАНА, не браузера:
// менеджер в другой стране видит ту же «19:00», что и гость. Через Intl, без зависимостей.

/** Календарные части момента в заданном поясе (час — 00–23). Общая основа для всех подписей времени. */
export function zonedParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** "20.10.2026 19:00" в заданном поясе. */
export function formatInZone(iso: string, timeZone: string): string {
  const { year, month, day, hour, minute } = zonedParts(iso, timeZone);
  return `${day}.${month}.${year} ${hour}:${minute}`;
}

/** "только что" / "5 мин назад" / "3 ч назад" / "2 дн назад". Будущее и отрицательные интервалы — «только что». */
export function timeAgo(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

/** С момента iso прошло больше ms миллисекунд. */
export function isOlderThan(iso: string, ms: number, now: Date): boolean {
  return now.getTime() - Date.parse(iso) > ms;
}
