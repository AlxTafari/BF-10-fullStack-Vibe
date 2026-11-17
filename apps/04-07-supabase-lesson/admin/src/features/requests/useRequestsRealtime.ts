import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useStore } from "react-redux";
import { toast } from "sonner";
import { type ConnectionStatus, startRequestsRealtime } from "@/api/requestsRealtime";
import { useGetRestaurantQuery } from "@/api/restaurantApi";
import type { AppDispatch } from "@/api/store";
import { guestsLabel } from "@/domain/plural";
import { GUEST_REQUEST_KIND_LABEL, type GuestRequestKind } from "@/domain/guestRequestStatus";
import { formatInZone } from "@/domain/time";
import { markRecent } from "./recentRows";

/**
 * Подписка на заявки на всё время сессии менеджера (ADR-003). Живёт в защищённом layout'е, а не на странице:
 * бейджи в навигации нужны везде, а подписку на странице пришлось бы пересоздавать при каждом переходе.
 * Экраны канал не видят — они читают кэш, в который события вливает слой api.
 */
export function useRequestsRealtime(restaurantId: string, playSound: () => void): ConnectionStatus {
  const store = useStore();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const restaurant = useGetRestaurantQuery(restaurantId);

  // Колбэки канала живут дольше одного рендера; свежие значения читаем из ref, канал из-за них не пересоздаём.
  const timeZone = restaurant.data?.timezone ?? "UTC";
  const latest = useRef({ timeZone, playSound });
  useEffect(() => {
    latest.current = { timeZone, playSound };
  });

  useEffect(() => {
    const close = startRequestsRealtime(restaurantId, store.dispatch as AppDispatch, store.getState, {
      onStatus: setStatus,
      onNewBooking: (row) => {
        markRecent(row.id);
        latest.current.playSound();
        const when = formatInZone(row.booking_at, latest.current.timeZone);
        toast(`Новая бронь: ${row.guest_name}, ${guestsLabel(row.guests_count)}, ${when}`, {
          action: {
            label: "Открыть",
            onClick: () =>
              void navigate({ to: "/bookings/$bookingId", params: { bookingId: row.id }, search: { tab: "pending", when: "upcoming", size: 20 } }),
          },
        });
      },
      onNewGuestRequest: (row) => {
        markRecent(row.id);
        latest.current.playSound();
        toast(`Новое обращение: ${GUEST_REQUEST_KIND_LABEL[row.kind as GuestRequestKind] ?? row.kind}`, {
          action: {
            label: "Открыть",
            onClick: () =>
              void navigate({ to: "/requests/$requestId", params: { requestId: row.id }, search: { tab: "new", kind: "all", size: 20 } }),
          },
        });
      },
    });
    // Выход, смена ресторана, размонтирование: канал закрывается, висящих подписок не остаётся.
    return close;
  }, [restaurantId, store, navigate]);

  return status;
}
