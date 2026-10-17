import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "react-redux";
import { loadMoreConversations, useGetConversationsQuery } from "@/api/chatApi";
import type { AppDispatch } from "@/api/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listTimeLabel } from "@/domain/chatTime";
import type { ConversationRow } from "@/domain/conversations";
import { LoadError } from "@/features/common/LoadError";
import { useNow } from "@/features/common/useNow";
import { cn } from "@/lib/utils";

/** Имя гостя: display_name, иначе «Гость» + 4 символа id (по ним отличаются безымянные диалоги). */
export const guestName = (c: { id: string; display_name: string | null }) => c.display_name?.trim() || `Гость ${c.id.slice(0, 4)}`;

function previewText(c: ConversationRow): string {
  if (c.last_message_preview === null) return "Нажатия кнопок";
  // Превью — недоверенный текст гостя: React экранирует, ссылкой не становится.
  return `${c.last_message_direction === "out" ? "Бот" : "Гость"}: ${c.last_message_preview}`;
}

export function ConversationList({ activeId, timeZone }: { activeId: string | undefined; timeZone: string }) {
  const store = useStore();
  const now = useNow();
  const list = useGetConversationsQuery({ cursor: null });
  const rows = list.data?.rows ?? [];
  const nextCursor = list.data?.nextCursor ?? null;

  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const busy = useRef(false);
  const loadMore = useCallback(async () => {
    if (!nextCursor || busy.current) return;
    busy.current = true;
    setLoadingMore(true);
    setMoreError(null);
    const error = await loadMoreConversations(store.dispatch as AppDispatch, nextCursor);
    busy.current = false;
    setLoadingMore(false);
    setMoreError(error);
  }, [nextCursor, store]);

  // Догрузка по IntersectionObserver у конца списка; кнопка «Загрузить ещё» — запасной путь, если наблюдателя нет.
  const hasObserver = typeof IntersectionObserver !== "undefined";
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasObserver || !nextCursor || moreError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasObserver, nextCursor, moreError, loadMore, rows.length]);

  if (list.error && rows.length === 0) {
    return (
      <div className="p-3">
        <LoadError error={list.error} onRetry={list.refetch} />
      </div>
    );
  }
  if (list.isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">Пока никто не писал боту</p>;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <ul>
        {rows.map((c) => {
          const active = c.id === activeId;
          // Активный диалог читается прямо сейчас — бейдж на нём только мешает.
          const unread = active ? 0 : c.unread_count;
          return (
            <li key={c.id}>
              <Link
                to="/chats/$conversationId"
                params={{ conversationId: c.id }}
                aria-current={active ? "page" : undefined}
                className={cn("block border-b px-3 py-2.5 hover:bg-accent", active && "bg-accent")}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-sm", unread > 0 ? "font-semibold" : "font-medium")}>{guestName(c)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{listTimeLabel(c.last_message_at, now, timeZone)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">{previewText(c)}</span>
                  {unread > 0 && <Badge aria-label={`непрочитанных: ${unread}`}>{unread >= 100 ? "99+" : unread}</Badge>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {nextCursor && (
        <div ref={sentinel} className="p-3 text-center text-xs text-muted-foreground">
          {loadingMore ? (
            "Загрузка…"
          ) : moreError ? (
            <span role="alert" className="space-x-2">
              <span className="text-destructive">Не удалось загрузить: {moreError}</span>
              <Button variant="outline" size="sm" onClick={() => void loadMore()}>
                Повторить
              </Button>
            </span>
          ) : (
            !hasObserver && (
              <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
                Загрузить ещё
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}
