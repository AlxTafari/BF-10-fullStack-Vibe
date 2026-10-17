import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useParams } from "@tanstack/react-router";
import { useGetMeQuery } from "@/api/authApi";
import { useGetConversationQuery, useGetConversationsQuery } from "@/api/chatApi";
import { useGetRestaurantQuery } from "@/api/restaurantApi";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInZone } from "@/domain/time";
import { LoadError } from "@/features/common/LoadError";
import { cn } from "@/lib/utils";
import { ConversationList, guestName } from "./ConversationList";
import { GuestRequestsPanel } from "./GuestRequestsPanel";
import { MessageFeed } from "./MessageFeed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram" };

/**
 * Раскладка «Чаты». Широкий экран: список слева, лента справа (и панель заявок на очень широком).
 * Узкий (< 768px): /chats — только список, /chats/$conversationId — только лента с «← Диалоги».
 */
export function ChatsScreen() {
  const { conversationId } = useParams({ strict: false }) as { conversationId?: string };
  const { data: me } = useGetMeQuery();
  const restaurant = useGetRestaurantQuery(me?.restaurantId ?? skipToken);
  const timeZone = restaurant.data?.timezone ?? "UTC";

  return (
    <section className="flex h-[calc(100dvh-6.5rem)] overflow-hidden rounded-md border">
      <aside className={cn("w-full flex-col border-r md:flex md:w-80 md:shrink-0", conversationId ? "hidden" : "flex")}>
        <ConversationList activeId={conversationId} timeZone={timeZone} />
      </aside>
      <div className={cn("min-w-0 flex-1 flex-col md:flex", conversationId ? "flex" : "hidden")}>
        {conversationId ? (
          UUID.test(conversationId) ? (
            <ChatView key={conversationId} conversationId={conversationId} timeZone={timeZone} />
          ) : (
            <NotFound />
          )
        ) : (
          <p className="m-auto p-4 text-sm text-muted-foreground">Выберите диалог слева</p>
        )}
      </div>
    </section>
  );
}

function NotFound() {
  return (
    <div className="m-auto space-y-3 p-4 text-center">
      <p className="text-sm">Диалог не найден</p>
      <Link to="/chats" className="text-sm underline underline-offset-2">
        ← К списку диалогов
      </Link>
    </div>
  );
}

function ChatView({ conversationId, timeZone }: { conversationId: string; timeZone: string }) {
  const header = useGetConversationQuery(conversationId);
  // Живая отметка прочтения берётся из списка (его обновляют события), шапка — запасной источник (прямая ссылка).
  const listRow = useGetConversationsQuery({ cursor: null }).data?.rows.find((r) => r.id === conversationId);

  if (header.isLoading) return <Skeleton className="m-4 h-16" />;
  if (header.error) {
    return (
      <div className="p-4">
        <LoadError error={header.error} onRetry={header.refetch} />
      </div>
    );
  }
  const conversation = header.data;
  if (!conversation) return <NotFound />;

  const readAt = listRow ? listRow.manager_last_read_at : conversation.manager_last_read_at;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="space-y-1 border-b px-4 py-3">
          <Link to="/chats" className="text-xs text-muted-foreground underline-offset-2 hover:underline md:hidden">
            ← Диалоги
          </Link>
          <h1 className="truncate text-base font-semibold">{guestName(conversation)}</h1>
          <p className="text-xs text-muted-foreground">
            {CHANNEL_LABEL[conversation.channel] ?? conversation.channel} · диалог начат {formatInZone(conversation.created_at, timeZone)}
          </p>
        </header>

        {/* Узкий экран: заявки — сворачиваемая секция над лентой. */}
        <details className="border-b px-4 py-2 xl:hidden">
          <summary className="cursor-pointer text-sm">Заявки гостя</summary>
          <div className="pt-2">
            <GuestRequestsPanel conversationId={conversationId} timeZone={timeZone} />
          </div>
        </details>

        <MessageFeed conversationId={conversationId} timeZone={timeZone} readAt={readAt} />
      </div>

      <aside className="hidden w-72 shrink-0 space-y-3 overflow-y-auto border-l p-3 xl:block">
        <h2 className="text-sm font-semibold">Заявки гостя</h2>
        <GuestRequestsPanel conversationId={conversationId} timeZone={timeZone} />
      </aside>
    </div>
  );
}
