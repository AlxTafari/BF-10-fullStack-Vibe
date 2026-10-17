import { createFileRoute } from "@tanstack/react-router";

// Сам маршрут ничего не рисует: список и лента — в родительском /chats; адрес даёт ссылку на диалог.
export const Route = createFileRoute("/_authed/chats/$conversationId")({ component: () => null });
