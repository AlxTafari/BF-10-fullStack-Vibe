import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useGetMeQuery } from "@/api/authApi";
import { type BookingRequest, useGetBookingsQuery } from "@/api/requestsApi";
import { useGetRestaurantQuery } from "@/api/restaurantApi";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isPastDue, managerNotificationFailed } from "@/domain/bookingStatus";
import { guestsLabel } from "@/domain/plural";
import { type BookingsSearch, bookingsSearchSchema } from "@/domain/requestLists";
import { formatInZone, timeAgo } from "@/domain/time";
import { LoadError } from "@/features/common/LoadError";
import { useNow } from "@/features/common/useNow";
import { BookingSheet } from "./BookingSheet";
import { ContactValue } from "./ContactValue";
import { ListControls } from "./ListControls";
import { BookingStatusBadge } from "./StatusBadges";
import { tabClass } from "./tabClass";
import { useIsRecent } from "./recentRows";

const TABS: { tab: BookingsSearch["tab"]; label: string }[] = [
  { tab: "pending", label: "Ожидают" },
  { tab: "confirmed", label: "Подтверждённые" },
  { tab: "closed", label: "Закрытые" },
  { tab: "all", label: "Все" },
];

const EMPTY_TEXT: Record<BookingsSearch["tab"], string> = {
  pending: "Нет заявок, ожидающих ответа",
  confirmed: "Нет подтверждённых броней",
  closed: "Нет закрытых заявок",
  all: "Заявок пока нет",
};

export function BookingsScreen() {
  // Фильтры живут в URL. Парсим здесь же: неверное значение → значение по умолчанию (как и в validateSearch маршрута).
  const search = bookingsSearchSchema.parse(useSearch({ strict: false }));
  const { bookingId } = useParams({ strict: false }) as { bookingId?: string };
  const navigate = useNavigate();
  const now = useNow();

  const { data: me } = useGetMeQuery();
  const restaurantId = me?.restaurantId ?? null;
  const restaurant = useGetRestaurantQuery(restaurantId ?? skipToken);
  // `when` важен только для «Подтверждённых»; на других вкладках не плодим лишние записи кэша.
  const list = useGetBookingsQuery(
    restaurantId ? { restaurantId, tab: search.tab, when: search.tab === "confirmed" ? search.when : "upcoming" } : skipToken,
  );
  // Явный объект вместо (prev) => prev: ссылки не зависят от параметров других экранов.
  const current: BookingsSearch = { tab: search.tab, when: search.when, size: search.size };
  const timeZone = restaurant.data?.timezone ?? "UTC";
  const rows = list.data ?? [];
  const shown = rows.slice(0, search.size);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Брони</h1>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(({ tab, label }) => (
          <Link key={tab} to="/bookings" search={{ ...current, tab }} className={tabClass(search.tab === tab)}>
            {label}
          </Link>
        ))}
        {search.tab === "confirmed" && (
          <span className="ml-2 flex gap-1">
            {(["upcoming", "past"] as const).map((when) => (
              <Link key={when} to="/bookings" search={{ ...current, when }} className={tabClass(search.when === when)}>
                {when === "upcoming" ? "Предстоящие" : "Прошедшие"}
              </Link>
            ))}
          </span>
        )}
      </div>

      {list.error ? (
        <LoadError error={list.error} onRetry={list.refetch} />
      ) : list.isLoading || !restaurantId ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{EMPTY_TEXT[search.tab]}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Когда</TableHead>
                <TableHead>Имя</TableHead>
                <TableHead>Гости</TableHead>
                <TableHead>Контакт</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Создана</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <BookingRow key={row.id} row={row} timeZone={timeZone} now={now} search={current} />
              ))}
            </TableBody>
          </Table>
          <ListControls
            size={search.size}
            loaded={rows.length}
            shown={shown.length}
            onSizeChange={(size) => void navigate({ to: "/bookings", search: { ...current, size } })}
          />
        </>
      )}

      {bookingId && (
        <BookingSheet
          bookingId={bookingId}
          timeZone={timeZone}
          search={current}
          onClose={() => void navigate({ to: "/bookings", search: current })}
        />
      )}
    </section>
  );
}

function BookingRow({
  row,
  timeZone,
  now,
  search,
}: {
  row: BookingRequest;
  timeZone: string;
  now: Date;
  search: BookingsSearch;
}) {
  const recent = useIsRecent(row.id);
  const navigate = useNavigate();
  return (
    <TableRow
      className={`cursor-pointer ${recent ? "bg-amber-100 dark:bg-amber-900/30" : ""}`}
      onClick={() =>
        void navigate({ to: "/bookings/$bookingId", params: { bookingId: row.id }, search })
      }
    >
      <TableCell className="whitespace-nowrap">
        <Link
          to="/bookings/$bookingId"
          params={{ bookingId: row.id }}
          search={search}
          className="font-medium underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {formatInZone(row.booking_at, timeZone)}
        </Link>
        {row.status === "pending" && isPastDue(row.booking_at, now) && (
          <Badge variant="destructive" className="ml-2">
            время прошло
          </Badge>
        )}
      </TableCell>
      {/* Имя и контакт вводит гость — выводим только как текст, длинные строки переносим. */}
      <TableCell className="max-w-48 break-words whitespace-normal">
        {row.guest_name}
        {row.replaces_id && (
          <Badge variant="outline" className="ml-2">
            изменение
          </Badge>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">{guestsLabel(row.guests_count)}</TableCell>
      <TableCell className="max-w-48 whitespace-normal">
        <ContactValue contact={row.contact} />
      </TableCell>
      <TableCell>
        <BookingStatusBadge status={row.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {timeAgo(row.created_at, now)}
        {managerNotificationFailed(row, now) && (
          <Badge
            variant="outline"
            className="ml-2 border-amber-500 text-amber-600"
            title="Менеджер мог не получить сообщение в Telegram — проверьте manager_chat_id"
          >
            уведомление не доставлено
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}
