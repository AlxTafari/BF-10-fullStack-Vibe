import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useGetMeQuery, useSignOutMutation } from "@/api/authApi";
import { useGetOpenCountsQuery } from "@/api/requestsApi";
import type { ConnectionStatus } from "@/api/requestsRealtime";
import { useAppSelector } from "@/api/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/features/common/LoadError";
import { useNotifySound } from "@/features/requests/useNotifySound";
import { useRequestsRealtime } from "@/features/requests/useRequestsRealtime";
import { NoAccess } from "./NoAccess";

const BASE_TITLE = "Админка ресторана";

const CONNECTION_LABEL: Record<ConnectionStatus, { text: string; className: string }> = {
  online: { text: "● онлайн", className: "text-green-600" },
  connecting: { text: "● подключение…", className: "text-muted-foreground" },
  offline: { text: "● нет связи, переподключаем…", className: "text-destructive" },
};

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
      <div className="mx-auto mt-24 max-w-sm text-center">
        <LoadError error={me.error} onRetry={me.refetch} />
      </div>
    );
  }
  if (me.data?.restaurantId == null) return <NoAccess />;

  return <Shell restaurantId={me.data.restaurantId} email={email} onSignOut={() => signOut()} signingOut={signingOut} />;
}

/** Каркас для менеджера с рестораном: навигация, бейджи «ожидают», подписка Realtime, индикатор связи, звук. */
function Shell({
  restaurantId,
  email,
  onSignOut,
  signingOut,
}: {
  restaurantId: string;
  email: string | null;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const sound = useNotifySound();
  // Один канал на сессию менеджера — здесь, а не на странице: бейджи нужны на любом экране.
  const connection = useRequestsRealtime(restaurantId, sound.play);
  const counts = useGetOpenCountsQuery(restaurantId).data;
  const open = (counts?.bookings ?? 0) + (counts?.guestRequests ?? 0);

  // Число ожидающих заявок в заголовке вкладки — видно, даже когда вкладка не в фокусе.
  useEffect(() => {
    document.title = open > 0 ? `(${open}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [open]);

  const nav = [
    { to: "/bookings", label: "Брони", badge: counts?.bookings ?? 0 },
    { to: "/requests", label: "Обращения", badge: counts?.guestRequests ?? 0 },
    { to: "/menu", label: "Меню", badge: 0 },
    { to: "/faq", label: "FAQ", badge: 0 },
    { to: "/restaurant", label: "Ресторан", badge: 0 },
  ] as const;
  const state = CONNECTION_LABEL[connection];

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 border-b px-4 py-3">
        <nav className="flex flex-wrap gap-4">
          {nav.map(({ to, label, badge }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-1.5 text-sm text-muted-foreground [&.active]:font-medium [&.active]:text-foreground"
            >
              {label}
              {badge > 0 && <Badge aria-label={`ожидают: ${badge}`}>{badge}</Badge>}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span role="status" className={`text-xs ${state.className}`}>
            {state.text}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={sound.toggle}
            aria-pressed={sound.enabled}
            title={sound.waitingForClick ? "Нажмите, чтобы браузер разрешил звук" : "Звук при новой заявке"}
            className={sound.enabled && !sound.waitingForClick ? "" : "text-muted-foreground"}
          >
            {sound.enabled ? "🔔" : "🔕"} Звук
          </Button>
          <span className="text-sm text-muted-foreground">{email}</span>
          <Button variant="outline" size="sm" onClick={onSignOut} disabled={signingOut}>
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
