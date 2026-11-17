import { skipToken } from "@reduxjs/toolkit/query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useGetMeQuery } from "@/api/authApi";
import { type GuestRequest, useGetGuestRequestsQuery } from "@/api/requestsApi";
import { useGetRestaurantQuery } from "@/api/restaurantApi";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GUEST_REQUEST_KINDS, GUEST_REQUEST_KIND_LABEL } from "@/domain/guestRequestStatus";
import { type GuestRequestsSearch, guestRequestsSearchSchema } from "@/domain/requestLists";
import { formatInZone, timeAgo } from "@/domain/time";
import { LoadError } from "@/features/common/LoadError";
import { useNow } from "@/features/common/useNow";
import { ContactValue } from "./ContactValue";
import { GuestRequestSheet } from "./GuestRequestSheet";
import { ListControls } from "./ListControls";
import { GuestRequestStatusBadge, kindLabel } from "./StatusBadges";
import { tabClass } from "./tabClass";
import { useIsRecent } from "./recentRows";

const TABS: { tab: GuestRequestsSearch["tab"]; label: string }[] = [
  { tab: "new", label: "Новые" },
  { tab: "in_progress", label: "В работе" },
  { tab: "resolved", label: "Решённые" },
  { tab: "all", label: "Все" },
];

const PREVIEW_LENGTH = 120;
const preview = (text: string) => (text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text);

export function GuestRequestsScreen() {
  const search = guestRequestsSearchSchema.parse(useSearch({ strict: false }));
  const { requestId } = useParams({ strict: false }) as { requestId?: string };
  const navigate = useNavigate();
  const now = useNow();

  const { data: me } = useGetMeQuery();
  const restaurantId = me?.restaurantId ?? null;
  const restaurant = useGetRestaurantQuery(restaurantId ?? skipToken);
  const list = useGetGuestRequestsQuery(restaurantId ? { restaurantId, tab: search.tab, kind: search.kind } : skipToken);
  const current: GuestRequestsSearch = { tab: search.tab, kind: search.kind, size: search.size };
  const timeZone = restaurant.data?.timezone ?? "UTC";
  const rows = list.data ?? [];
  const shown = rows.slice(0, search.size);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Обращения</h1>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(({ tab, label }) => (
          <Link key={tab} to="/requests" search={{ ...current, tab }} className={tabClass(search.tab === tab)}>
            {label}
          </Link>
        ))}
        <Select
          value={search.kind}
          onValueChange={(kind) =>
            void navigate({ to: "/requests", search: { ...current, kind: kind as GuestRequestsSearch["kind"] } })
          }
        >
          <SelectTrigger size="sm" className="ml-auto w-48" aria-label="Тип обращения">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {GUEST_REQUEST_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {GUEST_REQUEST_KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {list.error ? (
        <LoadError error={list.error} onRetry={list.refetch} />
      ) : list.isLoading || !restaurantId ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Обращений нет</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Тип</TableHead>
                <TableHead>Текст</TableHead>
                <TableHead>Контакт</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Когда</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <GuestRequestRow key={row.id} row={row} now={now} search={current} />
              ))}
            </TableBody>
          </Table>
          <ListControls
            size={search.size}
            loaded={rows.length}
            shown={shown.length}
            onSizeChange={(size) => void navigate({ to: "/requests", search: { ...current, size } })}
          />
        </>
      )}

      {requestId && (
        <GuestRequestSheet
          requestId={requestId}
          timeZone={timeZone}
          onClose={() => void navigate({ to: "/requests", search: current })}
        />
      )}
    </section>
  );
}

function GuestRequestRow({ row, now, search }: { row: GuestRequest; now: Date; search: GuestRequestsSearch }) {
  const recent = useIsRecent(row.id);
  const navigate = useNavigate();
  return (
    <TableRow
      className={`cursor-pointer ${recent ? "bg-amber-100 dark:bg-amber-900/30" : ""}`}
      onClick={() =>
        void navigate({ to: "/requests/$requestId", params: { requestId: row.id }, search })
      }
    >
      <TableCell>
        <Badge variant="outline">{kindLabel(row.kind)}</Badge>
      </TableCell>
      {/* Текст пишет гость: только как текст, длинные слова без пробелов переносим. */}
      <TableCell className="max-w-md break-words whitespace-normal">
        <Link
          to="/requests/$requestId"
          params={{ requestId: row.id }}
          search={search}
          className="underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {preview(row.text)}
        </Link>
      </TableCell>
      <TableCell className="max-w-48 whitespace-normal">
        <ContactValue contact={row.contact} />
      </TableCell>
      <TableCell>
        <GuestRequestStatusBadge status={row.status} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground" title={formatInZone(row.created_at, "UTC")}>
        {timeAgo(row.created_at, now)}
      </TableCell>
    </TableRow>
  );
}
