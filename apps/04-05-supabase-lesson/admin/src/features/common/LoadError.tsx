import { Button } from "@/components/ui/button";

/** Ошибка загрузки экрана: сообщение + «Повторить». */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3">
      <p className="text-sm text-destructive">Не удалось загрузить данные: {message}</p>
      <Button variant="outline" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  );
}
