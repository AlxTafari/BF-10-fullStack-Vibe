import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "@/domain/messages";

const BOTTOM_TOLERANCE_PX = 24;

/**
 * Поведение прокрутки ленты (спека S06 §2.В). Кэш хранит сообщения «новые → старые».
 *  - подгрузка СТАРЫХ сверху: содержимое не прыгает — сохраняем расстояние до низа (scrollTop += прирост высоты);
 *  - новое сообщение: лента прилипает к низу, ТОЛЬКО если пользователь уже внизу; иначе остаётся на месте,
 *    счётчик «новых» растёт;
 *  - первая отрисовка — вниз. Смена диалога обнуляет всё: компонент ленты пересоздаётся (key = id диалога).
 */
export function useFeedScroll(rows: readonly Message[]) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);

  const atBottomRef = useRef(true);
  const prev = useRef<{ newestId: string | null; oldestId: string | null; height: number }>({ newestId: null, oldestId: null, height: 0 });

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_TOLERANCE_PX;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setNewCount(0);
  }, []);

  // useLayoutEffect: поправка scrollTop должна случиться до отрисовки кадра, иначе содержимое мигнёт на старом месте.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const newestId = rows[0]?.id ?? null;
    const oldestId = rows[rows.length - 1]?.id ?? null;
    const before = prev.current;

    if (before.newestId === null) {
      // Первая отрисовка с данными: сразу вниз.
      if (newestId !== null) el.scrollTop = el.scrollHeight;
    } else {
      if (oldestId !== before.oldestId && newestId === before.newestId) {
        // Догрузили старые: сохраняем положение относительно того, что читали.
        el.scrollTop += el.scrollHeight - before.height;
      }
      if (newestId !== before.newestId) {
        if (atBottomRef.current) {
          el.scrollTop = el.scrollHeight;
        } else {
          // Сколько сообщений новее прежнего самого нового (не нашли — кэш заменён после дыры: считаем одно).
          const index = rows.findIndex((r) => r.id === before.newestId);
          setNewCount((n) => n + (index > 0 ? index : 1));
        }
      }
    }
    prev.current = { newestId, oldestId, height: el.scrollHeight };
  }, [rows]);

  const jumpToBottom = useCallback(() => {
    scrollToBottom();
    setNewCount(0);
  }, [scrollToBottom]);

  return { scrollerRef, onScroll, atBottom, newCount, jumpToBottom };
}
