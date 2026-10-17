import { useEffect, useState } from "react";
import { useStore } from "react-redux";
import { startConversationsRealtime } from "@/api/chatRealtime";
import type { ConnectionStatus } from "@/api/requestsRealtime";
import type { AppDispatch } from "@/api/store";

/**
 * Подписка на диалоги ресторана на всё время сессии менеджера (ADR-003), как подписка на заявки в S05:
 * бейдж непрочитанных нужен на любой странице, а не только в «Чатах». Одна подписка на ресторан;
 * выход, смена ресторана и размонтирование закрывают канал.
 */
export function useConversationsRealtime(restaurantId: string): ConnectionStatus {
  const store = useStore();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  useEffect(() => startConversationsRealtime(restaurantId, store.dispatch as AppDispatch, setStatus), [restaurantId, store]);
  return status;
}
