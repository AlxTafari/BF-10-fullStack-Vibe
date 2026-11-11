// Блок «AI-помощник» в настройках ресторана (S09 §4.15). Таблица restaurant_ai_settings, диапазоны — те же, что
// check в миграции 20261111100000_ai_layer_data.sql и в боте (supabase/functions/_shared/domain/aiSettings.ts):
// общего модуля нет, у админки и бота разные сборки. Разойдутся — БД отклонит сохранение, форма покажет ошибку.
import { z } from "zod";

export const HISTORY_WINDOW_RANGE = { min: 4, max: 30 } as const;
export const DAILY_TURN_LIMIT_RANGE = { min: 5, max: 500 } as const;

/** Строка restaurant_ai_settings без restaurant_id — то, что читает и сохраняет экран. */
export interface AiSettingsRecord {
  ai_enabled: boolean;
  history_window: number;
  daily_turn_limit: number;
}

/** Целое в диапазоне из строки поля ввода. Пустое и дробное — ошибка с диапазоном в тексте. */
const intInRange = (range: { min: number; max: number }) =>
  z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= range.min && Number(v) <= range.max, `Целое число от ${range.min} до ${range.max}`);

// Числа в форме — строки, как в полях ввода (как restaurantSchema): иначе пустое поле превращается в 0 или NaN.
export const aiSettingsSchema = z.object({
  ai_enabled: z.boolean(),
  history_window: intInRange(HISTORY_WINDOW_RANGE),
  daily_turn_limit: intInRange(DAILY_TURN_LIMIT_RANGE),
});

export type AiSettingsFormValues = z.infer<typeof aiSettingsSchema>;

export function toAiFormValues(r: AiSettingsRecord): AiSettingsFormValues {
  return { ai_enabled: r.ai_enabled, history_window: String(r.history_window), daily_turn_limit: String(r.daily_turn_limit) };
}

/** Значения формы (уже прошедшие схему) → patch для БД. */
export function toAiSettingsUpdate(v: AiSettingsFormValues): AiSettingsRecord {
  return { ai_enabled: v.ai_enabled, history_window: Number(v.history_window), daily_turn_limit: Number(v.daily_turn_limit) };
}
