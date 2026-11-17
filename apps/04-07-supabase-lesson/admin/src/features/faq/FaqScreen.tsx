import { skipToken } from "@reduxjs/toolkit/query";
import { useState } from "react";
import { toast } from "sonner";
import { useGetMeQuery } from "@/api/authApi";
import {
  type FaqEntry,
  useDeleteFaqMutation,
  useGetFaqQuery,
  useReorderFaqMutation,
  useSetFaqPublishedMutation,
} from "@/api/faqApi";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reorder } from "@/domain/reorder";
import { LoadError } from "@/features/common/LoadError";
import { SortableItem, SortableList } from "@/features/common/SortableList";
import { FaqDialog } from "./FaqDialog";

const ANSWER_PREVIEW = 80;

const preview = (text: string) => (text.length > ANSWER_PREVIEW ? `${text.slice(0, ANSWER_PREVIEW)}…` : text);

// undefined — диалог закрыт, null — создание, запись — правка.
type DialogState = undefined | null | FaqEntry;

export function FaqScreen() {
  const { data: me } = useGetMeQuery();
  const restaurantId = me?.restaurantId ?? null;
  const { data: entries, error, isLoading, refetch } = useGetFaqQuery(restaurantId ?? skipToken);
  const [reorderFaq, { isLoading: reordering }] = useReorderFaqMutation();
  const [setPublished] = useSetFaqPublishedMutation();
  const [deleteFaq, { isLoading: deleting }] = useDeleteFaqMutation();
  const [dialog, setDialog] = useState<DialogState>(undefined);
  const [toDelete, setToDelete] = useState<FaqEntry | null>(null);

  async function handleMove(from: number, to: number) {
    if (!entries || !restaurantId) return;
    const changes = reorder(entries, from, to);
    if (changes.length === 0) return;
    // Оптимистичное обновление и откат — внутри мутации; здесь только сообщение об ошибке.
    const result = await reorderFaq({ restaurantId, entries, changes });
    if (result.error) toast.error(`Не удалось сохранить порядок: ${result.error.message ?? "ошибка"}`);
  }

  async function handleToggle(entry: FaqEntry, is_published: boolean) {
    if (!restaurantId) return;
    const result = await setPublished({ restaurantId, id: entry.id, is_published });
    if (result.error) toast.error(`Не удалось изменить публикацию: ${result.error.message ?? "ошибка"}`);
  }

  async function handleDelete() {
    if (!toDelete) return;
    const result = await deleteFaq(toDelete.id);
    if (result.error) {
      toast.error(`Не удалось удалить: ${result.error.message ?? "ошибка"}`);
      return;
    }
    toast.success("Удалено");
    setToDelete(null);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">FAQ</h1>
        <Button onClick={() => setDialog(null)} disabled={!restaurantId}>
          Добавить вопрос
        </Button>
      </div>

      {isLoading && <Skeleton className="h-48 w-full" />}
      {error && <LoadError error={error} onRetry={refetch} />}
      {entries && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">Пока нет вопросов — добавьте первый.</p>
      )}

      {entries && entries.length > 0 && (
        // SortableList снаружи <table>: DndContext рендерит служебные div'ы, внутри tbody они были бы невалидной разметкой.
        <SortableList ids={entries.map((e) => e.id)} onMove={handleMove}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Вопрос</TableHead>
                <TableHead>Ответ</TableHead>
                <TableHead className="w-28">Опубликован</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
                {entries.map((entry) => (
                  // Пока сохраняется предыдущая перестановка, тянуть нельзя: два батча с разной нормализацией перезаписали бы друг друга.
                  <SortableItem key={entry.id} id={entry.id} disabled={reordering}>
                    {({ setNodeRef, style, handle }) => (
                      <TableRow ref={setNodeRef} style={style}>
                        <TableCell>{handle}</TableCell>
                        <TableCell className="font-medium">{entry.question}</TableCell>
                        <TableCell className="text-muted-foreground">{preview(entry.answer)}</TableCell>
                        <TableCell>
                          <Switch
                            checked={entry.is_published}
                            onCheckedChange={(checked) => handleToggle(entry, checked)}
                            aria-label={`Опубликован: ${entry.question}`}
                          />
                        </TableCell>
                        <TableCell className="space-x-2 text-right">
                          <Button variant="outline" size="sm" onClick={() => setDialog(entry)}>
                            Изменить
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setToDelete(entry)}>
                            Удалить
                          </Button>
                        </TableCell>
                      </TableRow>
                    )}
                  </SortableItem>
                ))}
            </TableBody>
          </Table>
        </SortableList>
      )}

      {dialog !== undefined && restaurantId && (
        <FaqDialog restaurantId={restaurantId} entry={dialog} onClose={() => setDialog(undefined)} />
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить вопрос?</AlertDialogTitle>
            <AlertDialogDescription>
              Гости перестанут его видеть. Если вопрос может понадобиться позже, лучше снимите его с публикации.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            {/* preventDefault: диалог закрываем сами, только после успешного ответа. */}
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
    </section>
  );
}
