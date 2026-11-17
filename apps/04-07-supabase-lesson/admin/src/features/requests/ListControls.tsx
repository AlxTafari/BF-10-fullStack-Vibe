import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LIST_LIMIT, PAGE_SIZES, type PageSize } from "@/domain/requestLists";

interface Props {
  size: PageSize;
  onSizeChange: (size: PageSize) => void;
  /** Сколько строк загружено (не больше LIST_LIMIT). */
  loaded: number;
  /** Сколько показано при выбранном размере. */
  shown: number;
}

/** Под списком: «Показано 20 из 57», выбор размера (срез на клиенте) и пометка об упоре в лимит запроса. */
export function ListControls({ size, onSizeChange, loaded, shown }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        Показано {shown} из {loaded}
        {loaded >= LIST_LIMIT && ` · Показаны последние ${LIST_LIMIT}`}
      </span>
      <label className="flex items-center gap-2">
        Показывать
        <Select value={String(size)} onValueChange={(v) => onSizeChange(Number(v) as PageSize)}>
          <SelectTrigger size="sm" className="w-20" aria-label="Размер списка">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
