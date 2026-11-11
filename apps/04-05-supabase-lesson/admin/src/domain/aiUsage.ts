// Статистика AI-помощника (S09, сессия 5). Чистые функции: без React, сети и Redux.
// Источник — RPC ai_usage_daily: суммы расхода из messages.meta по дням (в поясе ресторана) и моделям.
// В БД хранятся токены, а не деньги: цены меняются, поэтому стоимость считается здесь, по таблице цен с датами.
import { dayKey } from "./chatTime";
import { zonedParts } from "./time";

/** Строка ответа ai_usage_daily. */
export interface AiUsageDay {
  /** Календарный день в поясе ресторана, "2026-11-11". */
  day: string;
  /** '' — запасной ответ без вызова модели (лимит, сбой до первого запроса). */
  model: string;
  turns: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  ms_total: number;
  fallback_error: number;
  fallback_timeout: number;
  fallback_quota: number;
  fallback_limit: number;
}

/**
 * Цены Gemini API, платный уровень (Standard), долларов за 1 млн токенов. «Размышления» оплачиваются как выход.
 * from — первый день действия цены (включительно), по календарю ресторана: точность до часа тут не нужна.
 * Источник — https://aistudio.google.com/docs/pricing, сверено 2026-11-11. Смена цены — новая строка, старые
 * не трогаем: иначе пересчитается прошлый месяц.
 */
export const MODEL_PRICES: readonly { model: string; from: string; inputPer1M: number; outputPer1M: number }[] = [
  { model: "gemini-3.6-flash", from: "2000-01-01", inputPer1M: 0.75, outputPer1M: 3.75 },
  { model: "gemini-3.6-flash", from: "2027-01-01", inputPer1M: 1.5, outputPer1M: 7.5 },
  { model: "gemini-3.5-flash-lite", from: "2000-01-01", inputPer1M: 0.3, outputPer1M: 2.5 },
];

/** Цена модели на день: последняя строка с from ≤ day. Модели нет в таблице — null (стоимость неизвестна). */
export function priceFor(model: string, day: string) {
  let found: (typeof MODEL_PRICES)[number] | null = null;
  for (const p of MODEL_PRICES) {
    if (p.model === model && p.from <= day && (!found || p.from > found.from)) found = p;
  }
  return found;
}

export interface AiUsageSummary {
  turns: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  /** Среднее время ответа агента, мс; null — ходов не было. */
  avgMs: number | null;
  fallbacks: { error: number; timeout: number; quota: number; limit: number };
  /** Оценка стоимости в долларах по моделям с известной ценой. */
  costUsd: number;
  /** Модели с расходом, но без цены в MODEL_PRICES: их стоимость в costUsd не вошла — экран об этом говорит. */
  unpricedModels: string[];
}

export function summarizeAiUsage(rows: AiUsageDay[]): AiUsageSummary {
  const s: AiUsageSummary = {
    turns: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    avgMs: null,
    fallbacks: { error: 0, timeout: 0, quota: 0, limit: 0 },
    costUsd: 0,
    unpricedModels: [],
  };
  let msTotal = 0;
  const unpriced = new Set<string>();
  for (const r of rows) {
    s.turns += r.turns;
    s.calls += r.calls;
    s.inputTokens += r.input_tokens;
    s.outputTokens += r.output_tokens;
    s.thoughtTokens += r.thought_tokens;
    msTotal += r.ms_total;
    s.fallbacks.error += r.fallback_error;
    s.fallbacks.timeout += r.fallback_timeout;
    s.fallbacks.quota += r.fallback_quota;
    s.fallbacks.limit += r.fallback_limit;

    const tokens = r.input_tokens + r.output_tokens + r.thought_tokens;
    if (tokens === 0) continue; // запасной ответ без вызова модели ничего не стоит
    const price = priceFor(r.model, r.day);
    if (!price) {
      unpriced.add(r.model || "неизвестная модель");
      continue;
    }
    s.costUsd += (r.input_tokens * price.inputPer1M + (r.output_tokens + r.thought_tokens) * price.outputPer1M) / 1_000_000;
  }
  s.avgMs = s.turns > 0 ? Math.round(msTotal / s.turns) : null;
  s.unpricedModels = [...unpriced].sort();
  return s;
}

export type AiUsagePeriod = "day" | "week" | "month";

export const PERIOD_LABELS: Record<AiUsagePeriod, string> = { day: "Сегодня", week: "7 дней", month: "30 дней" };
const PERIOD_DAYS: Record<AiUsagePeriod, number> = { day: 1, week: 7, month: 30 };

/** "2026-11-11" ± n календарных дней (без поясов: только арифметика дат). */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Полночь календарного дня в поясе → момент UTC. Смещение пояса берём на сам этот момент и уточняем вторым
 * шагом: в день перехода на летнее/зимнее время смещение в полночь и в 00:00 UTC может отличаться.
 */
export function zonedMidnight(day: string, timeZone: string): Date {
  const wall = Date.parse(`${day}T00:00:00Z`); // «настенное» время как будто в UTC
  const offsetAt = (t: number) => {
    const p = zonedParts(new Date(t).toISOString(), timeZone);
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - t;
  };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return new Date(t);
}

/**
 * Границы периода [from, to) в поясе ресторана: «сегодня» — с полуночи до следующей полуночи, «7 / 30 дней» —
 * включая сегодня. По календарным дням, а не «now − 24 ч»: так совпадает с разбивкой ai_usage_daily по дням.
 */
export function periodRange(period: AiUsagePeriod, now: Date, timeZone: string): { from: string; to: string } {
  const today = dayKey(now.toISOString(), timeZone);
  return {
    from: zonedMidnight(addDays(today, 1 - PERIOD_DAYS[period]), timeZone).toISOString(),
    to: zonedMidnight(addDays(today, 1), timeZone).toISOString(),
  };
}

/** "$0.0123" — у копеечных сумм больше знаков, иначе всё было бы «$0.00». */
export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  return value < 1 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

/** "12 345" — тысячи через неразрывный пробел, как принято в русском. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}
