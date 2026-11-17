import { Link } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  type MenuCategory,
  type MenuItem,
  useDeleteCategoryMutation,
  useReorderCategoriesMutation,
} from "@/api/menuApi";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { NO_CATEGORY } from "@/domain/dishSchema";
import { reorder } from "@/domain/reorder";
import { SortableItem, SortableList } from "@/features/common/SortableList";
import { CategoryDialog } from "./CategoryDialog";

interface Props {
  restaurantId: string;
  categories: MenuCategory[];
  items: MenuItem[];
  selectedId: string;
}

const rowClass = (active: boolean) =>
  `flex items-center gap-1 rounded-md px-2 py-1 ${active ? "bg-accent" : "hover:bg-accent/50"}`;

// «блюдо / блюда / блюд» для текста подтверждения удаления.
function dishesWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "блюдо";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "блюда";
  return "блюд";
}

export function CategoriesPanel({ restaurantId, categories, items, selectedId }: Props) {
  const [reorderCategories, { isLoading: reordering }] = useReorderCategoriesMutation();
  const [deleteCategory, { isLoading: deleting }] = useDeleteCategoryMutation();
  // undefined — диалог закрыт, null — создание, категория — переименование.
  const [dialog, setDialog] = useState<undefined | null | MenuCategory>(undefined);
  const [toDelete, setToDelete] = useState<MenuCategory | null>(null);

  const countIn = (categoryId: string | null) => items.filter((i) => i.category_id === categoryId).length;

  async function handleMove(from: number, to: number) {
    const changes = reorder(categories, from, to);
    if (changes.length === 0) return;
    const result = await reorderCategories({ restaurantId, categories, changes });
    if (result.error) toast.error(`Не удалось сохранить порядок: ${result.error.message ?? "ошибка"}`);
  }

  async function handleDelete() {
    if (!toDelete) return;
    const result = await deleteCategory(toDelete.id);
    if (result.error) {
      toast.error(`Не удалось удалить: ${result.error.message ?? "ошибка"}`);
      return;
    }
    toast.success("Категория удалена");
    setToDelete(null);
  }

  const deleteCount = toDelete ? countIn(toDelete.id) : 0;
  const orphans = countIn(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Категории</h2>
        <Button size="sm" onClick={() => setDialog(null)}>
          Добавить
        </Button>
      </div>

      {categories.length === 0 && <p className="text-sm text-muted-foreground">Пока нет категорий — добавьте первую.</p>}

      <SortableList ids={categories.map((c) => c.id)} onMove={handleMove}>
        <ul className="space-y-1">
          {categories.map((category) => (
            <SortableItem key={category.id} id={category.id} disabled={reordering}>
              {({ setNodeRef, style, handle }) => (
                <li ref={setNodeRef} style={style} className={rowClass(selectedId === category.id)}>
                  {handle}
                  <Link
                    to="/menu/$categoryId"
                    params={{ categoryId: category.id }}
                    className="min-w-0 flex-1 truncate text-sm"
                  >
                    {category.name}
                  </Link>
                  <span className="text-xs text-muted-foreground">{countIn(category.id)}</span>
                  <Button variant="ghost" size="icon-sm" aria-label="Переименовать" onClick={() => setDialog(category)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Удалить" onClick={() => setToDelete(category)}>
                    <Trash2 />
                  </Button>
                </li>
              )}
            </SortableItem>
          ))}
        </ul>
      </SortableList>

      {/* Блюда без категории бот находит только поиском — менеджеру они должны быть видны. */}
      <ul>
        <li className={rowClass(selectedId === NO_CATEGORY)}>
          <Link to="/menu/$categoryId" params={{ categoryId: NO_CATEGORY }} className="flex-1 truncate text-sm italic">
            Без категории
          </Link>
          <span className="text-xs text-muted-foreground">{orphans}</span>
        </li>
      </ul>

      {dialog !== undefined && (
        <CategoryDialog restaurantId={restaurantId} category={dialog} onClose={() => setDialog(undefined)} />
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить категорию «{toDelete?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCount > 0
                ? `В категории ${deleteCount} ${dishesWord(deleteCount)}, они станут «Без категории» и пропадут из меню бота. Удалить?`
                : "Категория пуста, блюда не пострадают."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleting ? "Удаляем…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
