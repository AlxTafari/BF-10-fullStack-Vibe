import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALLERGEN_LABELS, type AllergenCode, EU_ALLERGEN_CODES, toggleAllergen } from "@/domain/allergens";
import type { AllergenMode } from "@/domain/dishSchema";

interface Props {
  mode: AllergenMode;
  tags: AllergenCode[];
  onModeChange: (mode: AllergenMode) => void;
  onTagsChange: (tags: AllergenCode[]) => void;
}

const MODE_LABELS: Record<AllergenMode, string> = {
  unset: "Не указано",
  none: "Аллергенов нет",
  list: "Указать",
};

/**
 * Три состояния, а не два: «не указано» (null) ≠ «аллергенов нет» ([]).
 * Бот на первое ответит «нет данных», на второе — «аллергены не указаны как присутствующие»;
 * для человека с аллергией это разные ответы.
 *
 * «Указать» — выбор из справочника ЕС, а не свободный ввод (S09): AI-фильтр по аллергенам работает
 * с кодами, и «глютен» / «пшеница» больше не расходятся в два разных значения.
 */
export function AllergenField({ mode, tags, onModeChange, onTagsChange }: Props) {
  return (
    <div className="space-y-2">
      <Select value={mode} onValueChange={(v) => onModeChange(v as AllergenMode)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(MODE_LABELS) as AllergenMode[]).map((m) => (
            <SelectItem key={m} value={m}>
              {MODE_LABELS[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {mode === "list" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {EU_ALLERGEN_CODES.map((code) => {
            const id = `allergen-${code}`;
            return (
              <div key={code} className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={tags.includes(code)}
                  // checked у Radix — boolean | "indeterminate"; промежуточного состояния здесь нет.
                  onCheckedChange={(checked) => onTagsChange(toggleAllergen(tags, code, checked === true))}
                />
                <Label htmlFor={id} className="text-sm leading-tight font-normal">
                  {ALLERGEN_LABELS[code]}
                </Label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
