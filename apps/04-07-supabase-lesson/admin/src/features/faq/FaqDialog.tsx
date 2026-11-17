import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { type FaqEntry, useCreateFaqMutation, useUpdateFaqMutation } from "@/api/faqApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_FAQ, type FaqValues, faqSchema } from "@/domain/faqSchema";

interface Props {
  restaurantId: string;
  /** null — создание новой записи, иначе правка. */
  entry: FaqEntry | null;
  onClose: () => void;
}

/** Создание и правка — один компонент. Монтируется только на время открытого диалога, поэтому форма всегда свежая. */
export function FaqDialog({ restaurantId, entry, onClose }: Props) {
  const [create, creating] = useCreateFaqMutation();
  const [update, updating] = useUpdateFaqMutation();
  const form = useForm<FaqValues>({
    resolver: zodResolver(faqSchema),
    defaultValues: entry
      ? { question: entry.question, answer: entry.answer, is_published: entry.is_published }
      : EMPTY_FAQ,
  });
  const busy = creating.isLoading || updating.isLoading;

  async function onSubmit(values: FaqValues) {
    const result = entry ? await update({ id: entry.id, values }) : await create({ restaurantId, values });
    if (result.error) {
      // Диалог остаётся открытым, ввод не теряется.
      toast.error(`Не удалось сохранить: ${result.error.message ?? "ошибка"}`);
      return;
    }
    toast.success("Сохранено");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? "Изменить вопрос" : "Новый вопрос"}</DialogTitle>
          <DialogDescription>Гость увидит запись в разделе FAQ бота.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="question"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Вопрос</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="answer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ответ</FormLabel>
                  <FormControl>
                    <Textarea rows={5} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="is_published"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel>Опубликован</FormLabel>
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
