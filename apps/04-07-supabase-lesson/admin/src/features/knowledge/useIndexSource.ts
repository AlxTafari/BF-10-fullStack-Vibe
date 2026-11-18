import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useIndexKnowledgeSourceMutation } from "@/api/knowledgeApi";
import { type SourceRef, indexOutcomeText, mapLimit } from "@/domain/knowledge";

/** Блюд категории индексируется одновременно — как в массовой индексации на сервере (лимит Gemini в минуту). */
const CONCURRENCY = 2;

/**
 * Вызов knowledge-index для одного или нескольких источников после сохранения.
 * - Сохранение уже прошло: сбой индексации только сообщаем, ничего не откатываем.
 * - `isIndexing(id)` — «Индексируется» в UI, пока ждём свой запрос (в БД такого статуса нет).
 * - Ушли со страницы — новые вызовы пачки не начинаем; уже отправленный может завершиться (это безопасно:
 *   сервер сверяет версию источника).
 * Статус после ответа приходит из БД: мутация инвалидирует теги, список перечитывается.
 */
export function useIndexSource() {
  const [indexSource] = useIndexKnowledgeSourceMutation();
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Причина неудачи или null — индекс обновлён. */
  const runOne = useCallback(
    async (ref: SourceRef): Promise<string | null> => {
      setRunning((s) => new Set(s).add(ref.id));
      try {
        const result = await indexSource(ref);
        if (result.error) return result.error.message ?? "ошибка";
        return indexOutcomeText(result.data);
      } finally {
        setRunning((s) => {
          const next = new Set(s);
          next.delete(ref.id);
          return next;
        });
      }
    },
    [indexSource],
  );

  /** Один источник. `failure` — начало фразы об ошибке: «Блюдо сохранено, индекс не обновлён». */
  const index = useCallback(
    async (ref: SourceRef, failure: string): Promise<boolean> => {
      const problem = await runOne(ref);
      if (problem) toast.error(`${failure}: ${problem}`);
      return problem === null;
    },
    [runOne],
  );

  /** Несколько источников (блюда переименованной/удалённой категории); одно итоговое сообщение. */
  const indexMany = useCallback(
    async (refs: SourceRef[], failure: string): Promise<void> => {
      if (refs.length === 0) return;
      const results = await mapLimit(refs, CONCURRENCY, runOne, () => alive.current);
      const problems = results.flatMap((r) =>
        r.status === "rejected" ? [String(r.reason)] : r.value === null ? [] : [r.value],
      );
      if (problems.length > 0) {
        toast.error(`${failure}: не обновлено ${problems.length} из ${refs.length} (${problems[0]})`);
      }
    },
    [runOne],
  );

  const isIndexing = useCallback((id: string) => running.has(id), [running]);

  return { index, indexMany, isIndexing };
}
