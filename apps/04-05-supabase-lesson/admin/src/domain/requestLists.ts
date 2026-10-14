// Фильтры списков «Брони» и «Обращения»: параметры в URL, правила «какие строки входят» и «в каком порядке».
// Одни и те же правила использует запрос (api строит по ним SQL) и вливание Realtime-событий (applyRowEvent),
// поэтому список после события выглядит так же, как после перезапроса.
import { z } from "zod";
import { GUEST_REQUEST_KINDS, GUEST_REQUEST_STATUSES } from "./guestRequestStatus";
import type { ListSpec } from "./realtimeMerge";

/** Сколько строк запрашиваем у БД. Пагинации по курсору здесь нет (спека S05, вопрос 4). */
export const LIST_LIMIT = 100;
export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

// `.catch(...)`: неверное значение в URL (ручная правка, старая ссылка) не ломает экран, а даёт значение по умолчанию.
const pageSize = z.coerce
  .number()
  .pipe(z.union([z.literal(20), z.literal(50), z.literal(100)]))
  .catch(DEFAULT_PAGE_SIZE);

export const bookingsSearchSchema = z.object({
  tab: z.enum(["pending", "confirmed", "closed", "all"]).catch("pending"),
  when: z.enum(["upcoming", "past"]).catch("upcoming"),
  size: pageSize,
});
export type BookingsSearch = z.infer<typeof bookingsSearchSchema>;

export const guestRequestsSearchSchema = z.object({
  tab: z.enum([...GUEST_REQUEST_STATUSES, "all"]).catch("new"),
  kind: z.enum([...GUEST_REQUEST_KINDS, "all"]).catch("all"),
  size: pageSize,
});
export type GuestRequestsSearch = z.infer<typeof guestRequestsSearchSchema>;

// ---------------------------------------------------------------- брони

export interface BookingListRow {
  id: string;
  status: string;
  booking_at: string;
  updated_at: string;
}

export type BookingFilter = Pick<BookingsSearch, "tab" | "when">;

const byTime = (field: "booking_at" | "updated_at", dir: 1 | -1) => (a: BookingListRow, b: BookingListRow) =>
  dir * (Date.parse(a[field]) - Date.parse(b[field])) || a.id.localeCompare(b.id);

/** Правила списка броней. `now` нужен для «предстоящие / прошедшие» на вкладке «Подтверждённые». */
export function bookingListSpec<T extends BookingListRow>(filter: BookingFilter, now: Date): ListSpec<T> {
  const isUpcoming = (r: BookingListRow) => Date.parse(r.booking_at) >= now.getTime();
  switch (filter.tab) {
    case "pending":
      return { matches: (r) => r.status === "pending", compare: byTime("booking_at", 1), limit: LIST_LIMIT };
    case "confirmed":
      return {
        matches: (r) => r.status === "confirmed" && (filter.when === "upcoming" ? isUpcoming(r) : !isUpcoming(r)),
        compare: byTime("booking_at", filter.when === "upcoming" ? 1 : -1),
        limit: LIST_LIMIT,
      };
    case "closed":
      return {
        matches: (r) => r.status === "declined" || r.status === "cancelled",
        compare: byTime("updated_at", -1),
        limit: LIST_LIMIT,
      };
    case "all":
      return { matches: () => true, compare: byTime("booking_at", -1), limit: LIST_LIMIT };
  }
}

// ---------------------------------------------------------------- обращения

export interface GuestRequestListRow {
  id: string;
  status: string;
  kind: string;
  created_at: string;
  updated_at: string;
}

export type GuestRequestFilter = Pick<GuestRequestsSearch, "tab" | "kind">;

export function guestRequestListSpec<T extends GuestRequestListRow>(filter: GuestRequestFilter): ListSpec<T> {
  return {
    matches: (r) => (filter.tab === "all" || r.status === filter.tab) && (filter.kind === "all" || r.kind === filter.kind),
    compare: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id),
    limit: LIST_LIMIT,
  };
}
