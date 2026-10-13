// Работа с датой и временем в часовом поясе ресторана. Без зависимостей — через Intl.DateTimeFormat.
// Даты — строки "YYYY-MM-DD", время — "HH:MM", моменты — Date (всегда UTC внутри).

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface WallClock {
  date: string; // YYYY-MM-DD
  minutes: number; // минут от полуночи
  asUtcMs: number; // то же «настенное» время, прочитанное как UTC (нужно для расчёта смещения)
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // hourCycle h23: иначе полночь может прийти как "24".
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Что показывали бы настенные часы в зоне в момент `instant`. */
function wallClock(instant: Date, timeZone: string): WallClock {
  const p: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return {
    date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`,
    minutes: p.hour * 60 + p.minute,
    asUtcMs: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second),
  };
}

/** Смещение зоны от UTC в момент `instant`, мс (учитывает летнее время). */
function offsetMs(instant: Date, timeZone: string): number {
  // Секунды/миллисекунды отбрасываем с обеих сторон, иначе смещение «плавает».
  const truncated = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  return wallClock(truncated, timeZone).asUtcMs - truncated.getTime();
}

/** Текущие дата и минуты от полуночи в зоне ресторана. */
export function localNow(now: Date, timeZone: string): { date: string; minutes: number } {
  const { date, minutes } = wallClock(now, timeZone);
  return { date, minutes };
}

export function isValidDateString(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  // 2026-02-30 «переезжает» в март — сравнением с исходными числами отсекаем несуществующие даты.
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** Календарная арифметика над датой-строкой (часовой пояс не нужен). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Сколько дней от `from` до `to` (отрицательно, если `to` раньше). */
export function diffDays(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

/** ISO-день недели: 1 = понедельник … 7 = воскресенье. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = воскресенье
  return js === 0 ? 7 : js;
}

/**
 * Локальные дата и время ресторана → момент в UTC (для timestamptz).
 * Несуществующее время (час, пропущенный при переводе часов вперёд) → null.
 * Двойное время (час повторяется при переводе назад) → более ранний из двух моментов.
 */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const dm = DATE_RE.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm || !isValidDateString(date)) return null;
  const [hours, minutes] = [Number(tm[1]), Number(tm[2])];
  if (hours > 23 || minutes > 59) return null;

  // Если бы зона была UTC — вот этот момент. Реальный отличается на смещение зоны.
  const naive = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hours, minutes);
  // Смещение сутки назад и сутки вперёд: на границе перевода часов они различаются, так находим оба кандидата.
  const offsets = new Set([
    offsetMs(new Date(naive - DAY_MS), timeZone),
    offsetMs(new Date(naive + DAY_MS), timeZone),
  ]);
  const wanted = hours * 60 + minutes;
  const matches = [...offsets]
    .map((off) => new Date(naive - off))
    // Кандидат годится, только если в зоне он действительно показывает запрошенные дату и время.
    .filter((c) => {
      const w = wallClock(c, timeZone);
      return w.date === date && w.minutes === wanted;
    })
    .sort((a, b) => a.getTime() - b.getTime());
  return matches[0] ?? null;
}

/** "20.10.2026 19:00" в зоне ресторана — для уведомлений менеджеру. */
export function formatLocalDateTime(instant: Date, timeZone: string): string {
  const w = wallClock(instant, timeZone);
  const [y, m, d] = w.date.split("-");
  const hh = String(Math.floor(w.minutes / 60)).padStart(2, "0");
  const mm = String(w.minutes % 60).padStart(2, "0");
  return `${d}.${m}.${y} ${hh}:${mm}`;
}
