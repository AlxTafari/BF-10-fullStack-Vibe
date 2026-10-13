import { X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type AllergenMode, addTag, removeTag } from "@/domain/dishSchema";

interface Props {
  mode: AllergenMode;
  tags: string[];
  onModeChange: (mode: AllergenMode) => void;
  onTagsChange: (tags: string[]) => void;
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
 */
export function AllergenField({ mode, tags, onModeChange, onTagsChange }: Props) {
  const [draft, setDraft] = useState("");

  function commit() {
    onTagsChange(addTag(tags, draft));
    setDraft("");
  }

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
        <>
          <Input
            value={draft}
            placeholder="Аллерген и Enter"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter внутри формы отправил бы её — здесь он добавляет тег.
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            // Недописанный тег не теряем при уходе из поля.
            onBlur={() => draft.trim() !== "" && commit()}
          />
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button
                  type="button"
                  aria-label={`Убрать ${tag}`}
                  onClick={() => onTagsChange(removeTag(tags, tag))}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
