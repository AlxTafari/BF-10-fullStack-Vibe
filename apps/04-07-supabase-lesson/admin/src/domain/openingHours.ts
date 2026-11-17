// Часы работы ресторана. Формат БД (колонка restaurants.opening_hours, jsonb) — тот же, что читает бот:
//   { "1": { "open": "13:00", "close": "24:00" }, … }
// ключ — ISO-день недели ("1" = понедельник … "7" = воскресенье); нет ключа = выходной;
// сама колонка null = «без ограничений». Пустой объект {} — «закрыто всегда» и это НЕ то же, что null.

export const DAY_KEYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  "1": "Понедельник",
  "2": "Вторник",
  "3": "Среда",
  "4": "Четверг",
  "5": "Пятница",
  "6": "Суббота",
  "7": "Воскресенье",
};

// type, а не interface: у type-алиаса есть неявная index signature, и значение совместимо с типом Json из supabase.
export type DayWindow = {
  open: string;
  close: string;
};

/** Формат БД. Partial: отсутствие ключа = выходной. */
export type OpeningHoursDb = Partial<Record<DayKey, DayWindow>>;

/** День в редакторе: время хранится и у выключенного дня, чтобы не терять ввод при переключении. */
export interface DayState extends DayWindow {
  enabled: boolean;
}

export interface HoursState {
  /** true → в БД пишется null («не ограничивать бронь»), дни при этом игнорируются. */
  unrestricted: boolean;
  days: Record<DayKey, DayState>;
}

const DEFAULT_OPEN = "09:00";
const DEFAULT_CLOSE = "22:00";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Открытие — обычное время суток. */
export function isValidOpen(time: string): boolean {
  return TIME_RE.test(time);
}

/** Закрытие — обычное время или «24:00» (бот понимает его как «до полуночи»). */
export function isValidClose(time: string): boolean {
  return TIME_RE.test(time) || time === "24:00";
}

/**
 * Ошибка в окне дня или null, если всё хорошо.
 * close <= open не пускаем: бот считает окно в пределах суток и такое окно трактует как пустое,
 * то есть брони молча перестали бы приниматься.
 */
export function validateWindow({ open, close }: DayWindow): string | null {
  if (!isValidOpen(open)) return "Время открытия: ЧЧ:ММ";
  if (!isValidClose(close)) return "Время закрытия: ЧЧ:ММ";
  if (toMinutes(close) <= toMinutes(open)) {
    return "Закрытие должно быть позже открытия. Работу через полночь («до 02:00») бот не поддерживает — используйте 24:00";
  }
  return null;
}

/** Ошибки по включённым дням. Выключенные не проверяем: их время в БД не попадёт. */
export function validateHours(state: HoursState): Partial<Record<DayKey, string>> {
  const errors: Partial<Record<DayKey, string>> = {};
  if (state.unrestricted) return errors;
  for (const key of DAY_KEYS) {
    const day = state.days[key];
    if (!day.enabled) continue;
    const error = validateWindow(day);
    if (error) errors[key] = error;
  }
  return errors;
}

function emptyDays(): Record<DayKey, DayState> {
  const days = {} as Record<DayKey, DayState>;
  for (const key of DAY_KEYS) days[key] = { enabled: false, open: DEFAULT_OPEN, close: DEFAULT_CLOSE };
  return days;
}

function isWindow(v: unknown): v is DayWindow {
  if (typeof v !== "object" || v === null) return false;
  const { open, close } = v as Record<string, unknown>;
  return typeof open === "string" && typeof close === "string";
}

/**
 * БД → состояние редактора. Принимает unknown: jsonb может содержать что угодно.
 * Ключи вне "1"…"7" и битые значения игнорируются (день считается выходным).
 */
export function fromDb(value: unknown): HoursState {
  const days = emptyDays();
  if (value === null || value === undefined) return { unrestricted: true, days };
  if (typeof value !== "object" || Array.isArray(value)) return { unrestricted: false, days };
  const record = value as Record<string, unknown>;
  for (const key of DAY_KEYS) {
    const window = record[key];
    if (isWindow(window)) days[key] = { enabled: true, open: window.open, close: window.close };
  }
  return { unrestricted: false, days };
}

/** Состояние редактора → БД. Предполагает, что validateHours не вернул ошибок. */
export function toDb(state: HoursState): OpeningHoursDb | null {
  if (state.unrestricted) return null;
  const result: OpeningHoursDb = {};
  for (const key of DAY_KEYS) {
    const { enabled, open, close } = state.days[key];
    if (enabled) result[key] = { open, close };
  }
  return result;
}

/** «Применить ко всем дням»: окно и флаг «работаем» выбранного дня копируются на остальные. */
export function applyToAll(state: HoursState, from: DayKey): HoursState {
  const source = state.days[from];
  const days = {} as Record<DayKey, DayState>;
  for (const key of DAY_KEYS) days[key] = { ...source };
  return { ...state, days };
}

/** Слова для интерфейса: различие «закрыто всегда» / «без ограничений» не должно жить только в переключателях. */
export function describeHours(state: HoursState): string {
  if (state.unrestricted) return "Бронь не ограничена часами работы: бот предлагает любые дни и время.";
  if (DAY_KEYS.every((key) => !state.days[key].enabled)) {
    return "Все дни выходные: ресторан закрыт всегда, бот не предложит ни одной даты для брони.";
  }
  return "Бронь возможна только в отмеченные дни и в указанные часы.";
}
