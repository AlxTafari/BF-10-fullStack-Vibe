import { X } from "lucide-react";
import { useState } from "react";
import type { MenuCategory, MenuItem } from "@/api/menuApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { moveItem, toggleDish } from "@/domain/knowledge";
import { SortableItem, SortableList } from "@/features/common/SortableList";

interface Props {
  items: MenuItem[];
  categories: MenuCategory[];
  /** Выбранные блюда в порядке подборки. */
  value: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Состав подборки: выбранные блюда (порядок — перетаскиванием) + список меню с поиском.
 * Черновики и стоп-лист выбрать можно: бот берёт из связей только опубликованные блюда и сам говорит «закончилось».
 */
export function DishPicker({ items, categories, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const byId = new Map(items.map((i) => [i.id, i]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  // Связь на удалённое блюдо удаляет БД (FK cascade), но кэш формы мог её пережить — такие id просто не показываем.
  const selected = value.filter((id) => byId.has(id));
  const q = query.trim().toLowerCase();
  const found = items.filter((i) => !q || i.name.toLowerCase().includes(q));

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">
        Состав подборки задаётся здесь, а не в тексте: бот называет только эти блюда, с текущими ценами и стоп-листом.
        В тексте опишите тему подборки.
      </p>

      {selected.length === 0 ? (
        <p className="text-sm">Блюда не выбраны — бот скажет, что позиций в подборке сейчас нет.</p>
      ) : (
        <SortableList ids={selected} onMove={(from, to) => onChange(moveItem(selected, from, to))}>
          <ol className="space-y-1">
            {selected.map((id) => {
              const item = byId.get(id) as MenuItem;
              return (
                <SortableItem key={id} id={id}>
                  {({ setNodeRef, style, handle }) => (
                    <li ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1">
                      {handle}
                      <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                      {!item.is_published && <Badge variant="outline">Черновик</Badge>}
                      {!item.is_available && <Badge variant="secondary">Стоп-лист</Badge>}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Убрать ${item.name}`}
                        onClick={() => onChange(toggleDish(selected, id))}
                      >
                        <X />
                      </Button>
                    </li>
                  )}
                </SortableItem>
              );
            })}
          </ol>
        </SortableList>
      )}

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Найти блюдо по названию"
        aria-label="Найти блюдо"
      />
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {found.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/50">
              <Checkbox checked={selected.includes(item.id)} onCheckedChange={() => onChange(toggleDish(selected, item.id))} />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="text-xs text-muted-foreground">
                {item.category_id ? categoryName.get(item.category_id) : "Без категории"}
              </span>
            </label>
          </li>
        ))}
        {found.length === 0 && <li className="px-2 text-sm text-muted-foreground">Ничего не найдено</li>}
      </ul>
    </div>
  );
}
