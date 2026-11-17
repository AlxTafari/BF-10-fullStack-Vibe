import { useEffect } from "react";
import { useStore } from "react-redux";
import { startMessagesRealtime } from "@/api/chatRealtime";
import type { AppDispatch } from "@/api/store";

/**
 * Подписка на сообщения ОДНОГО открытого диалога. Cleanup эффекта закрывает канал при смене диалога и при
 * уходе из раздела: одновременно живёт не больше одной подписки на messages (инвариант 10).
 * Статус связи общий (канал conversations в шапке), поэтому отдельный индикатор здесь не нужен.
 */
export function useMessagesRealtime(conversationId: string): void {
  const store = useStore();
  useEffect(() => {
    return startMessagesRealtime(conversationId, store.dispatch as AppDispatch, () => {});
  }, [conversationId, store]);
}
