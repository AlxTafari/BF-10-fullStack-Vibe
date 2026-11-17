// Подписи времени и дней в чате. Всё — в часовом поясе РЕСТОРАНА, не браузера (инвариант 8 спеки S06):
// сообщение в 23:50 и в 00:10 — разные дни, а граница дня на переходе на летнее/зимнее время не даёт «25 часов»,
// потому что день определяется календарной датой в поясе, а не делением на 24 часа.
import { zonedParts } from "./time";

/** Календарный день в поясе: "2026-10-18". Ключ группировки и сравнения дней. */
export function dayKey(iso: string, timeZone: string): string {
  const { year, month, day } = zonedParts(iso, timeZone);
  return `${year}-${month}-${day}`;
}

/** "19:05" в поясе ресторана. */
export function formatTimeHM(iso: string, timeZone: string): string {
  const { hour, minute } = zonedParts(iso, timeZone);
  return `${hour}:${minute}`;
}

const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** "2026-10-18" → числа. Ключи дня строим сами (dayKey), поэтому формат гарантирован. */
function splitDay(key: string): [year: number, month: number, day: number] {
  const [year = 0, month = 1, day = 1] = key.split("-").map(Number);
  return [year, month, day];
}

/** Сдвиг календарной даты на n дней. Арифметика по датам в UTC: переходы DST не влияют. */
function shiftDay(key: string, days: number): string {
  const [year, month, day] = splitDay(key);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Подпись разделителя дня: «Сегодня», «Вчера», «13 октября», а для другого года — «13 октября 2025». */
export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Сегодня";
  if (key === shiftDay(todayKey, -1)) return "Вчера";
  const [year, month, day] = splitDay(key);
  const base = `${day} ${MONTHS_GENITIVE[month - 1] ?? ""}`;
  return year === Number(todayKey.slice(0, 4)) ? base : `${base} ${year}`;
}

/** Время в строке списка диалогов: сегодня — «19:05», иначе дата «13.10» (для другого года «13.10.2025»). */
export function listTimeLabel(iso: string, now: Date, timeZone: string): string {
  const key = dayKey(iso, timeZone);
  if (key === dayKey(now.toISOString(), timeZone)) return formatTimeHM(iso, timeZone);
  const [year, month, day] = key.split("-");
  const currentYear = dayKey(now.toISOString(), timeZone).slice(0, 4);
  return year === currentYear ? `${day}.${month}` : `${day}.${month}.${year}`;
}
