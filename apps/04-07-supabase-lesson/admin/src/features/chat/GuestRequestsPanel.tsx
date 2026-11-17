import { Link } from "@tanstack/react-router";
import { useGetConversationRequestsQuery } from "@/api/chatApi";
import { Skeleton } from "@/components/ui/skeleton";
import { guestsLabel } from "@/domain/plural";
import { formatInZone } from "@/domain/time";
import { LoadError } from "@/features/common/LoadError";
import { BookingStatusBadge, GuestRequestStatusBadge, kindLabel } from "@/features/requests/StatusBadges";

/** Панель «Заявки гостя»: брони и обращения этого диалога со ссылками на карточки. */
export function GuestRequestsPanel({ conversationId, timeZone }: { conversationId: string; timeZone: string }) {
  const { data, error, isLoading, refetch } = useGetConversationRequestsQuery(conversationId);

  if (error) return <LoadError error={error} onRetry={refetch} />;
  if (isLoading || !data) return <Skeleton className="h-20 w-full" />;
  if (data.bookings.length === 0 && data.guestRequests.length === 0) {
    return <p className="text-sm text-muted-foreground">Заявок нет</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {data.bookings.map((b) => (
        <li key={b.id} className="space-y-1 rounded-md border p-2">
          <Link
            to="/bookings/$bookingId"
            params={{ bookingId: b.id }}
            search={{ tab: "all", when: "upcoming", size: 20 }}
            className="font-medium underline-offset-2 hover:underline"
          >
            {b.replaces_id ? "Изменение брони" : "Бронь"}: {formatInZone(b.booking_at, timeZone)}
          </Link>
          <div className="flex items-center gap-2 text-muted-foreground">
            {guestsLabel(b.guests_count)} <BookingStatusBadge status={b.status} />
          </div>
        </li>
      ))}
      {data.guestRequests.map((r) => (
        <li key={r.id} className="space-y-1 rounded-md border p-2">
          <Link
            to="/requests/$requestId"
            params={{ requestId: r.id }}
            search={{ tab: "all", kind: "all", size: 20 }}
            className="font-medium underline-offset-2 hover:underline"
          >
            Обращение: {kindLabel(r.kind)}
          </Link>
          <div className="flex items-center gap-2 text-muted-foreground">
            {formatInZone(r.created_at, timeZone)} <GuestRequestStatusBadge status={r.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}
