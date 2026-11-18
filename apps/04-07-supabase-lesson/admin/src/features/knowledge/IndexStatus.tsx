import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INDEX_STATE_LABEL, type IndexFields, indexState, needsIndex } from "@/domain/knowledge";

interface Props {
  row: IndexFields;
  /** UI ждёт свой запрос к индексатору — показываем «Индексируется» поверх статуса из БД. */
  indexing: boolean;
  onRetry: () => void;
  /** Текст ошибки под бейджем (в форме); в таблице — только во всплывающей подсказке. */
  showError?: boolean;
}

const VARIANT = {
  unpublished: "outline",
  pending: "secondary",
  ready: "default",
  error: "destructive",
} as const;

/** Статус индексации документа или блюда + «Повторить» для pending / error (доступна и после перезагрузки). */
export function IndexStatus({ row, indexing, onRetry, showError = false }: Props) {
  if (indexing) return <Badge variant="secondary">Индексируется…</Badge>;
  const state = indexState(row);
  const error = state === "error" ? row.index_error : null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={VARIANT[state]} title={error ?? undefined}>
          {INDEX_STATE_LABEL[state]}
        </Badge>
        {needsIndex(row) && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Повторить
          </Button>
        )}
      </div>
      {showError && error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
