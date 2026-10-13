import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  type MenuCategory,
  type MenuItem,
  useCreateMenuItemMutation,
  useUpdateMenuItemMutation,
} from "@/api/menuApi";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type DishFormValues,
  EMPTY_DISH,
  NO_CATEGORY,
  dishSchema,
  toDishPayload,
  toFormValues,
} from "@/domain/dishSchema";
import { AllergenField } from "./AllergenField";

interface Props {
  restaurantId: string;
  categories: MenuCategory[];
  currency: string;
  /** null — новое блюдо, иначе правка. */
  item: MenuItem | null;
  /** Категория, выбранная в списке: подставляется в новое блюдо. */
  defaultCategoryId: string;
  onClose: () => void;
}

type NumberFieldName =
  | "portion_grams"
  | "kcal_per_portion"
  | "protein_per_portion"
  | "fat_per_portion"
  | "carbs_per_portion";

const NUMBER_FIELDS: { name: NumberFieldName; label: string }[] = [
  { name: "portion_grams", label: "Порция, г" },
  { name: "kcal_per_portion", label: "Ккал" },
  { name: "protein_per_portion", label: "Белки, г" },
  { name: "fat_per_portion", label: "Жиры, г" },
  { name: "carbs_per_portion", label: "Углеводы, г" },
];

export function ItemSheet({ restaurantId, categories, currency, item, defaultCategoryId, onClose }: Props) {
  const [create, creating] = useCreateMenuItemMutation();
  const [update, updating] = useUpdateMenuItemMutation();
  const form = useForm<DishFormValues>({
    resolver: zodResolver(dishSchema),
    defaultValues: item ? toFormValues(item) : { ...EMPTY_DISH, category_id: defaultCategoryId },
  });
  const allergenMode = useWatch({ control: form.control, name: "allergenMode" });
  const busy = creating.isLoading || updating.isLoading;

  async function onSubmit(values: DishFormValues) {
    const payload = toDishPayload(values);
    const result = item ? await update({ id: item.id, payload }) : await create({ restaurantId, payload });
    if (result.error) {
      toast.error(`Не удалось сохранить: ${result.error.message ?? "ошибка"}`);
      return;
    }
    toast.success("Сохранено");
    onClose();
  }

  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{item ? "Изменить блюдо" : "Новое блюдо"}</SheetTitle>
          <SheetDescription>Новое блюдо — черновик, пока вы не включите «Опубликовано».</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 px-4 pb-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Категория</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_CATEGORY}>Без категории</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Цена, {currency}</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="0 — бесплатно" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Описание</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ingredients"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Состав</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Пустое поле = «не указано» (null), «0» = указан ноль. */}
            <div className="grid grid-cols-2 gap-3">
              {NUMBER_FIELDS.map(({ name, label }) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            <FormField
              control={form.control}
              name="allergenTags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Аллергены</FormLabel>
                  <AllergenField
                    mode={allergenMode}
                    tags={field.value}
                    onModeChange={(m) => form.setValue("allergenMode", m, { shouldDirty: true, shouldValidate: true })}
                    onTagsChange={field.onChange}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="photo_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ссылка на фото</FormLabel>
                  <FormControl>
                    <Input type="url" placeholder="https://" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex gap-6">
              <FormField
                control={form.control}
                name="is_published"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel>Опубликовано</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="is_available"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel>В наличии</FormLabel>
                  </FormItem>
                )}
              />
            </div>
            <SheetFooter className="px-0">
              <Button type="submit" disabled={busy}>
                {busy ? "Сохраняем…" : "Сохранить"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Отмена
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
