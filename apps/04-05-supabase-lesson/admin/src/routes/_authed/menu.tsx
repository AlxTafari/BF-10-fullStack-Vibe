import { createFileRoute } from "@tanstack/react-router";
import { MenuScreen } from "@/features/menu/MenuScreen";

// Layout без <Outlet>: выбранную категорию MenuScreen читает из параметров дочернего маршрута.
export const Route = createFileRoute("/_authed/menu")({ component: MenuScreen });
