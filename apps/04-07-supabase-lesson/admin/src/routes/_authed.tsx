import { createFileRoute, redirect } from "@tanstack/react-router";
import { hasSession } from "@/api/session";
import { AuthedLayout } from "@/features/auth/AuthedLayout";

export const Route = createFileRoute("/_authed")({
  // Guard: нет сессии → /login с возвратом на исходный адрес.
  beforeLoad: async ({ location }) => {
    if (!(await hasSession())) throw redirect({ to: "/login", search: { redirect: location.href } });
  },
  component: AuthedLayout,
});
