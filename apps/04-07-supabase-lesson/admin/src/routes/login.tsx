import { createFileRoute, redirect } from "@tanstack/react-router";
import { hasSession } from "@/api/session";
import { safeRedirect } from "@/domain/safeRedirect";
import { LoginForm } from "@/features/auth/LoginForm";

export const Route = createFileRoute("/login")({
  // Параметр приходит из URL: не доверяем — в компонент попадёт только строка или undefined.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  // Уже вошёл — на форму входа делать нечего.
  beforeLoad: async ({ search }) => {
    if (await hasSession()) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const { redirect: redirectTo } = Route.useSearch();
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-6 px-4">
      <h1 className="text-xl font-semibold">Вход в админку</h1>
      <LoginForm redirectTo={redirectTo} />
    </div>
  );
}
