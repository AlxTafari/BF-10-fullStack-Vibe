import { createFileRoute } from "@tanstack/react-router";

// Сам маршрут ничего не рисует: экран целиком в родительском /menu, здесь только параметр categoryId
// (uuid категории или "none" для «Без категории»).
export const Route = createFileRoute("/_authed/menu/$categoryId")({ component: () => null });
