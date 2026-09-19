// Дата терминала: обычный числовой формат, но летоисчисление сдвинуто в будущее.
// Год считается от created_at (UTC) — детерминированная функция от реальной даты, отдельного поля не нужно.

// Реальный год + этот сдвиг = год терминала (сейчас ≈ 2235).
const CALENDAR_YEAR_OFFSET = 209;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatTerminalDate(createdAt: string): string {
  const date = new Date(createdAt);
  const day = pad2(date.getUTCDate());
  const month = pad2(date.getUTCMonth() + 1);
  const year = date.getUTCFullYear() + CALENDAR_YEAR_OFFSET;
  return `${day}.${month}.${year}`;
}
