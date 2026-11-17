import { createFileRoute } from "@tanstack/react-router";
import { ChatsScreen } from "@/features/chat/ChatsScreen";

// Раскладка «список + лента»: выбранный диалог — часть адреса (/chats/$conversationId), поэтому ссылка,
// «назад» и перезагрузка работают. Дочерний маршрут ничего не рисует, экран читает его параметр сам.
export const Route = createFileRoute("/_authed/chats")({ component: ChatsScreen });
