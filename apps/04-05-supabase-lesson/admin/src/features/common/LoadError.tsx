import { Button } from "@/components/ui/button";

/** Ошибка загрузки экрана: сообщение + «Повторить». Принимает и ApiError, и SerializedError из RTK. */
export function LoadError({ error, onRetry }: { error: { message?: string }; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3">
      <p className="text-sm text-destructive">Не удалось загрузить данные: {error.message ?? "неизвестная ошибка"}</p>
      <Button variant="outline" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  );
}
