import { useEffect, useRef, useState } from "react";
import { useReindexKnowledgePortionMutation } from "@/api/knowledgeApi";
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
import { EMPTY_TOTALS, type ReindexTotals, type SourceRef, addPortion } from "@/domain/knowledge";

interface Props {
  restaurantId: string;
  /** Подпись источника в списке ошибок: название документа или блюда. */
  nameOf: (ref: SourceRef) => string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "running"; totals: ReindexTotals }
  /** failed — порция целиком не выполнилась (сеть, нет ключа); итог — по уже пройденным порциям. */
  | { kind: "done"; totals: ReindexTotals; failed?: string };

/**
 * «Переиндексировать всё»: порции последовательно, пока сервер не вернёт nextCursor = null.
 * Фоновой задачи нет — порции шлёт эта страница. Ушли со страницы — новую порцию не отправляем; уже отправленная
 * может завершиться на сервере, повторный запуск безопасен (каждая попытка сверяет версию источника).
 */
export function ReindexAll({ restaurantId, nameOf }: Props) {
  const [reindex] = useReindexKnowledgePortionMutation();
  const [confirm, setConfirm] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run() {
    setConfirm(false);
    let totals = EMPTY_TOTALS;
    let cursor: SourceRef | null = null;
    setPhase({ kind: "running", totals });
    do {
      const result = await reindex({ restaurantId, cursor });
      if (!alive.current) return;
      if (result.error) {
        setPhase({ kind: "done", totals, failed: result.error.message ?? "ошибка" });
        return;
      }
      totals = addPortion(totals, result.data);
      cursor = result.data.nextCursor;
      setPhase(cursor ? { kind: "running", totals } : { kind: "done", totals });
    } while (cursor && alive.current);
  }

  const running = phase.kind === "running";

  return (
    <>
      <Button variant="outline" onClick={() => setConfirm(true)} disabled={running}>
        {running ? "Переиндексация…" : "Переиндексировать всё"}
      </Button>

      {phase.kind !== "idle" && (
        // order-last + w-full: в шапке-флексе плашка уходит отдельной строкой под кнопки, а не между ними.
        <div role="status" className="order-last w-full rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {running ? `Переиндексация: порция ${phase.totals.portions + 1}…` : "Переиндексация завершена"}
            </span>
            {!running && (
              <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: "idle" })}>
                Скрыть
              </Button>
            )}
          </div>
          <p className="mt-1 text-muted-foreground">
            Успешно: {phase.totals.ready} · ошибки: {phase.totals.error} · пропущено: {phase.totals.skipped} ·
            устаревшая попытка: {phase.totals.superseded}
          </p>
          {phase.kind === "done" && phase.failed && (
            <p className="mt-1 text-destructive">Остановлено: {phase.failed}. Запустите ещё раз — готовое не пострадает.</p>
          )}
          {phase.totals.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-destructive">
              {phase.totals.errors.map((e) => (
                <li key={`${e.source}:${e.id}`}>
                  {e.source === "document" ? "Документ" : "Блюдо"} «{nameOf(e)}»: {e.message}
                </li>
              ))}
            </ul>
          )}
          {phase.kind === "done" && phase.totals.superseded > 0 && (
            <p className="mt-1 text-muted-foreground">
              Устаревшая попытка — источник изменили во время индексации; он ждёт повтора.
            </p>
          )}
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Переиндексировать всё?</AlertDialogTitle>
            <AlertDialogDescription>
              Все опубликованные документы и блюда заново отправятся в Gemini — это тратит запросы AI и занимает
              несколько минут. Не закрывайте страницу до конца: порции отправляет она. Поиск бота по готовым источникам
              во время переиндексации работает.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>Переиндексировать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
