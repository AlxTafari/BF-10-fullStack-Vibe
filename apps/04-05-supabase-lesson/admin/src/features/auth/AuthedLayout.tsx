import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useGetMeQuery, useSignOutMutation } from "@/api/authApi";
import { useAppSelector } from "@/api/store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NoAccess } from "./NoAccess";

const NAV = [
  { to: "/menu", label: "Меню" },
  { to: "/faq", label: "FAQ" },
  { to: "/restaurant", label: "Ресторан" },
] as const;

export function AuthedLayout() {
  const status = useAppSelector((s) => s.auth.status);
  const email = useAppSelector((s) => s.auth.email);
  const navigate = useNavigate();
  const location = useLocation();
  const [signOut, { isLoading: signingOut }] = useSignOutMutation();
  // skip: пока не знаем, что сессия живая, запрос бессмыслен.
  const me = useGetMeQuery(undefined, { skip: status !== "signedIn" });

  // Выход (в том числе в другой вкладке или протухший токен) → на /login с возвратом на текущий адрес.
  useEffect(() => {
    if (status === "signedOut") {
      void navigate({ to: "/login", search: { redirect: location.href }, replace: true });
    }
  }, [status, navigate, location.href]);

  if (status !== "signedIn" || me.isLoading) {
    return <Skeleton className="mx-auto mt-24 h-24 w-full max-w-sm" />;
  }
  if (me.error) {
    return (
      <div className="mx-auto mt-24 max-w-sm space-y-4 text-center">
        <p className="text-sm text-destructive">Не удалось загрузить данные: {me.error.message}</p>
        <Button onClick={() => me.refetch()}>Повторить</Button>
      </div>
    );
  }
  if (me.data?.restaurantId == null) return <NoAccess />;

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 border-b px-4 py-3">
        <nav className="flex gap-4">
          {NAV.map(({ to, label }) => (
            <Link key={to} to={to} className="text-sm text-muted-foreground [&.active]:font-medium [&.active]:text-foreground">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{email}</span>
          <Button variant="outline" size="sm" onClick={() => signOut()} disabled={signingOut}>
            Выйти
          </Button>
        </div>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
