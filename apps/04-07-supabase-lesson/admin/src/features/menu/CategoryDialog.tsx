import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { type MenuCategory, useCreateCategoryMutation, useRenameCategoryMutation } from "@/api/menuApi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { type CategoryValues, categorySchema } from "@/domain/categorySchema";

interface Props {
  restaurantId: string;
  /** null — новая категория, иначе переименование. */
  category: MenuCategory | null;
  onClose: () => void;
  /** Название существующей категории действительно сменилось — её блюдам нужна переиндексация. */
  onRenamed: (categoryId: string) => void;
}

export function CategoryDialog({ restaurantId, category, onClose, onRenamed }: Props) {
  const [create, creating] = useCreateCategoryMutation();
  const [rename, renaming] = useRenameCategoryMutation();
  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: category?.name ?? "" },
  });
  const busy = creating.isLoading || renaming.isLoading;

  async function onSubmit(values: CategoryValues) {
    const result = category ? await rename({ id: category.id, values }) : await create({ restaurantId, values });
    if (result.error) {
      toast.error(`Не удалось сохранить: ${result.error.message ?? "ошибка"}`);
      return;
    }
    toast.success("Сохранено");
    // Сравниваем с тем, что записала БД: «Салаты » → «Салаты» после trim — не переименование.
    if (category && "data" in result && result.data.name !== category.name) onRenamed(category.id);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? "Переименовать категорию" : "Новая категория"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Отмена
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Сохраняем…" : "Сохранить"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
