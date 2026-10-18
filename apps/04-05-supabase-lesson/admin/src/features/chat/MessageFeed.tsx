import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "react-redux";
import { loadOlderMessages, useGetMessagesQuery, useMarkConversationReadMutation } from "@/api/chatApi";
import type { AppDispatch } from "@/api/store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dayKey, dayLabel } from "@/domain/chatTime";
import { groupByDay, shouldMarkRead } from "@/domain/messages";
import { LoadError } from "@/features/common/LoadError";
import { useNow } from "@/features/common/useNow";
import { MessageItem } from "./MessageItem";
import { useFeedScroll } from "./useFeedScroll";
import { useMessagesRealtime } from "./useMessagesRealtime";

const LOAD_MORE_THRESHOLD_PX = 120;
const MARK_READ_DEBOUNCE_MS = 300;

/** Вкладка видима: скрытая вкладка не «читает» диалог (инвариант 13). */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/**
 * Лента одного диалога. Родитель задаёт key={conversationId}: смена диалога пересоздаёт компонент, и прокрутка,
 * счётчик новых, подписка и отметка прочтения сбрасываются сами.
 */
export function MessageFeed({
  conversationId,
  timeZone,
  readAt,
}: {
  conversationId: string;
  timeZone: string;
  /** Текущая отметка прочтения диалога (из списка / шапки): по ней отсекаем лишние вызовы. */
  readAt: string | null;
}) {
  const store = useStore();
  const now = useNow();
  // refetchOnMountOrArgChange: вернулись в диалог, пока кэш ещё жив, — события за время отсутствия потеряны
  // (подписка закрывалась); свежая первая страница сливается с кэшем и закрывает дыру.
  const feed = useGetMessagesQuery({ conversationId, cursor: null }, { refetchOnMountOrArgChange: true });
  useMessagesRealtime(conversationId);

  const rows = useMemo(() => feed.data?.rows ?? [], [feed.data]);
  const nextCursor = feed.data?.nextCursor ?? null;
  const { scrollerRef, onScroll, atBottom, newCount, jumpToBottom } = useFeedScroll(rows);
  const groups = useMemo(() => groupByDay(rows, timeZone), [rows, timeZone]);
  const today = dayKey(now.toISOString(), timeZone);

  // --- подгрузка старых ---------------------------------------------------------------------------------
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const busy = useRef(false);

  const loadOlder = useCallback(async () => {
    if (!nextCursor || busy.current) return;
    busy.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    const error = await loadOlderMessages(store.dispatch as AppDispatch, conversationId, nextCursor);
    busy.current = false;
    setLoadingOlder(false);
    setOlderError(error);
  }, [nextCursor, store, conversationId]);

  const handleScroll = useCallback(() => {
    onScroll();
    const el = scrollerRef.current;
    if (el && el.scrollTop < LOAD_MORE_THRESHOLD_PX && !olderError) void loadOlder();
  }, [onScroll, scrollerRef, loadOlder, olderError]);

  // Если все загруженные сообщения помещаются в окно, прокрутки нет и вверх «дотянуться» нечем: догружаем сами.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && nextCursor && !olderError && el.scrollHeight <= el.clientHeight + LOAD_MORE_THRESHOLD_PX) void loadOlder();
  }, [rows, nextCursor, olderError, loadOlder, scrollerRef]);

  // --- отметка прочтения --------------------------------------------------------------------------------
  const visible = usePageVisible();
  const [markRead] = useMarkConversationReadMutation();
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    const upTo = shouldMarkRead({ isOpen: true, atBottom, visible }, rows, readAt);
    if (!upTo || upTo === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = upTo;
      // Ошибка не показывается: lastSent сбросится, и отметка повторится при следующем подходящем моменте.
      void markRead({ conversationId, upTo }).unwrap().catch(() => {
        lastSent.current = null;
      });
    }, MARK_READ_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rows, atBottom, visible, readAt, conversationId, markRead]);

  if (feed.error && rows.length === 0) {
    return (
      <div className="p-4">
        <LoadError error={feed.error} onRetry={feed.refetch} />
      </div>
    );
  }
  if (feed.isLoading) {
    return (
      <div className="flex-1 space-y-3 p-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-10 w-3/5" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollerRef} onScroll={handleScroll} className="flex-1 space-y-2 overflow-y-auto p-4" role="log" aria-label="Переписка">
        <div className="py-1 text-center text-xs text-muted-foreground">
          {loadingOlder ? (
            "Загрузка…"
          ) : olderError ? (
            <span role="alert" className="space-x-2">
              <span className="text-destructive">Не удалось загрузить: {olderError}</span>
              <Button variant="outline" size="sm" onClick={() => void loadOlder()}>
                Повторить
              </Button>
            </span>
          ) : nextCursor ? (
            // Запасной путь, если прокрутка недоступна (например, скринридер или отключённые события scroll).
            <Button variant="ghost" size="sm" onClick={() => void loadOlder()}>
              Загрузить ещё
            </Button>
          ) : rows.length > 0 ? (
            "Начало переписки"
          ) : (
            // Диалог без сообщений в списке не бывает: пустая лента = переписку убрал ретеншн (S06c), а диалог остался из-за заявки.
            "Переписка удалена по сроку хранения"
          )}
        </div>

        {groups.map((group) => (
          <section key={group.day} className="space-y-2">
            <h3 className="sticky top-0 z-10 py-1 text-center text-xs font-medium text-muted-foreground">
              <span className="rounded-full bg-background/90 px-2 py-0.5">{dayLabel(group.day, today)}</span>
            </h3>
            {group.messages.map((message) => (
              <MessageItem key={message.id} message={message} timeZone={timeZone} />
            ))}
          </section>
        ))}
      </div>

      {newCount > 0 && !atBottom && (
        <Button size="sm" className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md" onClick={jumpToBottom}>
          ↓ Новые сообщения ({newCount})
        </Button>
      )}
      <p className="border-t px-4 py-2 text-center text-xs text-muted-foreground">Менеджер отвечает гостю вне бота</p>
    </div>
  );
}
