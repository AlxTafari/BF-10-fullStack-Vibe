import { skipToken } from "@reduxjs/toolkit/query";
import { useMemo, useState } from "react";
import { useGetMeQuery } from "@/api/authApi";
import { useGetAiUsageQuery } from "@/api/aiStatsApi";
import { useGetRestaurantQuery } from "@/api/restaurantApi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type AiUsagePeriod,
  PERIOD_LABELS,
  formatCount,
  formatUsd,
  periodRange,
  summarizeAiUsage,
} from "@/domain/aiUsage";
import { LoadError } from "@/features/common/LoadError";
import { tabClass } from "@/features/requests/tabClass";

// Ссылки AI Studio: API для остатка на счёте Gemini нет (проверено 2026-11-11), баланс смотрим там.
const BILLING_URL = "https://aistudio.google.com/billing";
const USAGE_URL = "https://aistudio.google.com/usage";

const PERIODS: AiUsagePeriod[] = ["day", "week", "month"];

const FALLBACK_LABELS = {
  limit: "лимит гостя исчерпан",
  quota: "квота Gemini (429)",
  timeout: "таймаут",
  error: "ошибка",
} as const;

/**
 * «Статистика AI» (S09 §2, сессия 5): ходы агента, токены, оценка стоимости, время ответа, запасные ответы.
 * Сессия 4: распознавание голосовых — отдельный блок; стоимость сверху — общая, с разбивкой по группам.
 * Без графиков: менеджеру нужны итоги за период, а не форма ряда. Периоды — по календарю ресторана.
 */
export function AiStatsScreen() {
  const { data: me } = useGetMeQuery();
  const restaurant = useGetRestaurantQuery(me?.restaurantId ?? skipToken);
  const timeZone = restaurant.data?.timezone;
  const [period, setPeriod] = useState<AiUsagePeriod>("day");

  // Границы считаем при смене периода, а не на каждый рендер: иначе ключ запроса менялся бы постоянно.
  // «Обновить» пересчитывает их — после полуночи «сегодня» уже другой день.
  const [tick, setTick] = useState(0);
  const range = useMemo(
    () => (timeZone ? periodRange(period, new Date(), timeZone) : null),
    // tick — намеренная зависимость: пересчёт по кнопке «Обновить».
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, timeZone, tick],
  );
  const usage = useGetAiUsageQuery(range ?? skipToken);
  const summary = useMemo(() => (usage.data ? summarizeAiUsage(usage.data) : null), [usage.data]);

  return (
    <section className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Статистика AI</h1>
        <div className="flex flex-wrap items-center gap-1">
          {PERIODS.map((p) => (
            <button key={p} type="button" className={tabClass(p === period)} aria-pressed={p === period} onClick={() => setPeriod(p)}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={usage.isFetching}
            onClick={() => {
              setTick((t) => t + 1);
              void usage.refetch();
            }}
          >
            Обновить
          </Button>
        </div>
      </div>

      {usage.error && <LoadError error={usage.error} onRetry={usage.refetch} />}
      {!summary && !usage.error && <Skeleton className="h-48 w-full" />}

      {summary && (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Ответов AI" value={formatCount(summary.turns)} hint={`вызовов модели: ${formatCount(summary.calls)}`} />
            <Stat
              label="Оценка стоимости"
              value={formatUsd(summary.totalCostUsd)}
              hint={`ответы ${formatUsd(summary.costUsd)} · голос ${formatUsd(summary.voice.costUsd)}`}
            />
            <Stat label="Среднее время ответа" value={summary.avgMs === null ? "—" : `${(summary.avgMs / 1000).toFixed(1)} с`} />
            <Stat
              label="Запасных ответов"
              value={formatCount(summary.fallbacks.limit + summary.fallbacks.quota + summary.fallbacks.timeout + summary.fallbacks.error)}
              hint="AI не ответил, гость получил кнопки"
            />
          </dl>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-4">
              <h2 className="mb-2 text-sm font-semibold">Токены ответов AI</h2>
              <dl className="space-y-1 text-sm">
                <Row label="Вход (вопрос, история, данные tools)" value={formatCount(summary.inputTokens)} />
                <Row label="Выход (ответы)" value={formatCount(summary.outputTokens)} />
                <Row label="«Размышления» модели" value={formatCount(summary.thoughtTokens)} hint="оплачиваются как выход" />
              </dl>
            </div>
            <div className="rounded-md border p-4">
              <h2 className="mb-2 text-sm font-semibold">Запасные ответы по причинам</h2>
              <dl className="space-y-1 text-sm">
                {(Object.keys(FALLBACK_LABELS) as (keyof typeof FALLBACK_LABELS)[]).map((k) => (
                  <Row key={k} label={FALLBACK_LABELS[k]} value={formatCount(summary.fallbacks[k])} />
                ))}
              </dl>
            </div>
            <div className="rounded-md border p-4 md:col-span-2">
              <h2 className="mb-2 text-sm font-semibold">Распознавание голосовых</h2>
              <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
                <Row label="Распознано" value={formatCount(summary.voice.transcribed)} hint="для AI и по кнопке «Распознать»" />
                <Row label="Не разобрано или сбой" value={formatCount(summary.voice.failed)} hint="вызов модели был, текста нет" />
                <Row label="Токены: вход (аудио)" value={formatCount(summary.voice.inputTokens)} />
                <Row label="Токены: выход и «размышления»" value={formatCount(summary.voice.outputTokens + summary.voice.thoughtTokens)} />
                <Row
                  label="Среднее время распознавания"
                  value={summary.voice.avgMs === null ? "—" : `${(summary.voice.avgMs / 1000).toFixed(1)} с`}
                />
                <Row label="Стоимость" value={formatUsd(summary.voice.costUsd)} />
              </dl>
            </div>
          </div>

          {summary.unpricedModels.length > 0 && (
            <p role="status" className="text-sm text-destructive">
              Нет цены для модели: {summary.unpricedModels.join(", ")}. Её расход в стоимость не вошёл — добавьте цену в
              таблицу MODEL_PRICES (admin/src/domain/aiUsage.ts).
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Стоимость — оценка по токенам и опубликованным ценам Gemini API; точная сумма и остаток на счёте — в{" "}
            <a className="underline underline-offset-2" href={BILLING_URL} target="_blank" rel="noreferrer">
              Billing
            </a>{" "}
            и{" "}
            <a className="underline underline-offset-2" href={USAGE_URL} target="_blank" rel="noreferrer">
              Usage
            </a>{" "}
            в AI Studio.
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
