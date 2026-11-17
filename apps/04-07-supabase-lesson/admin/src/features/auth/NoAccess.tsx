import { useSignOutMutation } from "@/api/authApi";
import { Button } from "@/components/ui/button";

/** Аккаунт есть, но в restaurant_managers его нет: данных не показываем, запросов больше не делаем. */
export function NoAccess() {
  const [signOut, { isLoading }] = useSignOutMutation();
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-4 text-center">
      <h1 className="text-xl font-semibold">Нет доступа к ресторану</h1>
      <p className="text-sm text-muted-foreground">Обратитесь к владельцу, чтобы вас назначили менеджером.</p>
      <Button onClick={() => signOut()} disabled={isLoading}>
        Выйти
      </Button>
    </div>
  );
}
