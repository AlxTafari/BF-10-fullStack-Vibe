import { createFileRoute, redirect } from "@tanstack/react-router";

// «/» → «/menu»; если сессии нет, guard защищённого layout'а отправит на /login.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/menu" });
  },
});
