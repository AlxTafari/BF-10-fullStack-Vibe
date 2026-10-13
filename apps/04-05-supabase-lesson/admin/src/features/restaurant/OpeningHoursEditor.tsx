import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DAY_KEYS,
  DAY_LABELS,
  type DayKey,
  type DayState,
  type HoursState,
  applyToAll,
  describeHours,
  validateHours,
} from "@/domain/openingHours";

interface Props {
  value: HoursState;
  onChange: (next: HoursState) => void;
}

/** Контролируемый редактор: состояние живёт в форме, здесь только отображение и правки. */
export function OpeningHoursEditor({ value, onChange }: Props) {
  const errors = validateHours(value);

  function patchDay(key: DayKey, patch: Partial<DayState>) {
    onChange({ ...value, days: { ...value.days, [key]: { ...value.days[key], ...patch } } });
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={value.unrestricted}
          onCheckedChange={(checked) => onChange({ ...value, unrestricted: checked === true })}
        />
        Не ограничивать бронь часами работы
      </label>

      {/* Одна фраза вместо догадок по переключателям: «закрыто всегда» и «без ограничений» — разное. */}
      <p className="text-sm text-muted-foreground">{describeHours(value)}</p>

      <ul className={value.unrestricted ? "space-y-2 opacity-50" : "space-y-2"}>
        {DAY_KEYS.map((key) => {
          const day = value.days[key];
          const error = errors[key];
          const disabled = value.unrestricted;
          return (
            <li key={key} className="space-y-1">
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  checked={day.enabled}
                  disabled={disabled}
                  onCheckedChange={(enabled) => patchDay(key, { enabled })}
                  aria-label={`${DAY_LABELS[key]}: работаем`}
                />
                <span className="w-32 text-sm">{DAY_LABELS[key]}</span>
                <Input
                  className="w-24"
                  value={day.open}
                  disabled={disabled || !day.enabled}
                  onChange={(e) => patchDay(key, { open: e.target.value })}
                  placeholder="ЧЧ:ММ"
                  aria-label={`${DAY_LABELS[key]}: открытие`}
                  aria-invalid={error ? true : undefined}
                />
                <span className="text-sm text-muted-foreground">—</span>
                <Input
                  className="w-24"
                  value={day.close}
                  disabled={disabled || !day.enabled}
                  onChange={(e) => patchDay(key, { close: e.target.value })}
                  placeholder="ЧЧ:ММ"
                  aria-label={`${DAY_LABELS[key]}: закрытие`}
                  aria-invalid={error ? true : undefined}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange(applyToAll(value, key))}
                >
                  Применить ко всем дням
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Формат ЧЧ:ММ. Для «до полуночи» укажите 24:00. Работа через полночь (например, до 02:00) не поддерживается.
      </p>
    </div>
  );
}
