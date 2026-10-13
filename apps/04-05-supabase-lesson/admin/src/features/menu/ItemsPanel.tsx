import { useState } from "react";
import { toast } from "sonner";
import { type ItemFlag, type MenuCategory, type MenuItem, useDeleteMenuItemMutation, useSetItemFlagMutation } from "@/api/menuApi";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BOT_CATEGORY_LIMIT, lacksNutrition } from "@/domain/dishSchema";
import { ItemSheet } from "./ItemSheet";

interface Props {
  restaurantId: string;
  currency: string;
  categories: MenuCategory[];
  /** Блюда выбранной категории (или «Без категории»). */
  items: MenuItem[];
  title: string;
  /** Что подставить в новое блюдо: id категории или "none". */
  selectedId: string;
}

const formatPrice = (price: number, currency: string) =>
  `${price.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${currency}`;

export function ItemsPanel({ restaurantId, currency, categories, items, title, selectedId }: Props) {
  const [setFlag] = useSetItemFlagMutation();
  const [deleteItem, { isLoading: deleting }] = useDeleteMenuItemMutation();
  // undefined — форма закрыта, null — новое блюдо, блюдо — правка.
  const [sheet, setSheet] = useState<undefined | null | MenuItem>(undefined);
  const [toDelete, setToDelete] = useState<MenuItem | null>(null);

  const publishedCount = items.filter((i) => i.is_published).length;

  async function handleFlag(item: MenuItem, flag: ItemFlag, value: boolean) {
    // Оптимистичное обновление и откат — внутри мутации; здесь только сообщение об ошибке.
    const result = await setFlag({ restaurantId, id: item.id, flag, value });
    if (result.error) toast.error(`Не удалось изменить: ${result.error.message ?? "ошибка"}`);
  }

  async function handleDelete() {
    if (!toDelete) return;
    const result = await deleteItem(toDelete.id);
    if (result.error) {
      toast.error(`Не удалось удалить: ${result.error.message ?? "ошибка"}`);
      return;
    }
    toast.success("Блюдо удалено");
    setToDelete(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{title}</h2>
        <Button size="sm" onClick={() => setSheet(null)}>
          Добавить блюдо
        </Button>
      </div>

      {publishedCount > BOT_CATEGORY_LIMIT && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          В категории больше {BOT_CATEGORY_LIMIT} блюд: гость увидит первые {BOT_CATEGORY_LIMIT} и подсказку искать по
          названию.
        </p>
      )}

      {items.length === 0 && <p className="text-sm text-muted-foreground">Здесь пока нет блюд — добавьте первое.</p>}

      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Блюдо</TableHead>
              <TableHead className="w-28">Цена</TableHead>
              <TableHead className="w-28">Опубликовано</TableHead>
              <TableHead className="w-24">В наличии</TableHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="font-medium">{item.name}</div>
                  <div className="mt-1 flex gap-1">
                    {!item.is_published && <Badge variant="outline">Черновик</Badge>}
                    {lacksNutrition(item) && <Badge variant="secondary">Нет КБЖУ</Badge>}
                  </div>
                </TableCell>
                <TableCell>{formatPrice(item.price, currency)}</TableCell>
                <TableCell>
                  <Switch
                    checked={item.is_published}
                    onCheckedChange={(v) => handleFlag(item, "is_published", v)}
                    aria-label={`Опубликовано: ${item.name}`}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={item.is_available}
                    onCheckedChange={(v) => handleFlag(item, "is_available", v)}
                    aria-label={`В наличии: ${item.name}`}
                  />
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button variant="outline" size="sm" onClick={() => setSheet(item)}>
                    Изменить
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setToDelete(item)}>
                    Удалить
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* key: при смене блюда форма пересоздаётся — defaultValues читаются один раз. */}
      {sheet !== undefined && (
        <ItemSheet
          key={sheet?.id ?? "new"}
          restaurantId={restaurantId}
          categories={categories}
          currency={currency}
          item={sheet}
          defaultCategoryId={selectedId}
          onClose={() => setSheet(undefined)}
        />
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{toDelete?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Блюдо удалится насовсем. Если оно нужно позже, лучше снимите его с публикации — оно пропадёт из меню бота,
              но останется здесь.
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
