// Настройки AI ресторана (S09 §4.15). Хранятся в restaurant_ai_settings, диапазоны держит check в БД.
// Здесь — значения по умолчанию и разбор строки: если строку удалили руками или пришло значение вне
// диапазона, бот работает на дефолтах, а не падает.

export interface AiSettings {
  /** Выключен → свободный текст получает поведение до S09 (поиск блюда), кнопки работают как всегда. */
  aiEnabled: boolean;
  /** Сколько последних сообщений диалога видит агент. */
  historyWindow: number;
  /** Ходов агента на гостя за сутки в часовом поясе ресторана. */
  dailyTurnLimit: number;
}

// Те же числа — default и check в миграции 20261111100000_ai_layer_data.sql.
export const DEFAULT_AI_SETTINGS: AiSettings = { aiEnabled: true, historyWindow: 12, dailyTurnLimit: 50 };
export const HISTORY_WINDOW_RANGE = { min: 4, max: 30 } as const;
export const DAILY_TURN_LIMIT_RANGE = { min: 5, max: 500 } as const;

const inRange = (value: unknown, range: { min: number; max: number }): value is number =>
  Number.isInteger(value) && (value as number) >= range.min && (value as number) <= range.max;

/** Строка БД → настройки. Нет строки или поле негодное — значение по умолчанию для этого поля. */
export function parseAiSettings(
  row: { ai_enabled?: unknown; history_window?: unknown; daily_turn_limit?: unknown } | null,
): AiSettings {
  return {
    aiEnabled: typeof row?.ai_enabled === "boolean" ? row.ai_enabled : DEFAULT_AI_SETTINGS.aiEnabled,
    historyWindow: inRange(row?.history_window, HISTORY_WINDOW_RANGE)
      ? row.history_window
      : DEFAULT_AI_SETTINGS.historyWindow,
    dailyTurnLimit: inRange(row?.daily_turn_limit, DAILY_TURN_LIMIT_RANGE)
      ? row.daily_turn_limit
      : DEFAULT_AI_SETTINGS.dailyTurnLimit,
  };
}
