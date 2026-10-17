import { skipToken } from "@reduxjs/toolkit/query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  type BookingRequest,
  useGetBookingQuery,
  useGetPendingChangeQuery,
  useSetBookingStatusMutation,
} from "@/api/requestsApi";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type BookingAction,
  type BookingStatus,
  allowedBookingActions,
  guestNotificationFailed,
  isBookingStatus,
  managerNotificationFailed,
} from "@/domain/bookingStatus";
import { guestsLabel } from "@/domain/plural";
import type { BookingsSearch } from "@/domain/requestLists";
import { formatInZone } from "@/domain/time";
import { OpenConversationLink } from "@/features/chat/OpenConversationLink";
import { LoadError } from "@/features/common/LoadError";
import { useNow } from "@/features/common/useNow";
import { ContactValue } from "./ContactValue";
import { BookingStatusBadge } from "./StatusBadges";

interface Props {
  bookingId: string;
  timeZone: string;
  /** Текущие фильтры списка: ссылки внутри карточки сохраняют их. */
  search: BookingsSearch;
  onClose: () => void;
}

export function BookingSheet({ bookingId, timeZone, search, onClose }: Props) {
  const booking = useGetBookingQuery(bookingId);
  const data = booking.data;
  // Для запроса на изменение — исходная бронь («Было → Стало»), для обычной — её ожидающее изменение.
  const original = useGetBookingQuery(data?.replaces_id ?? skipToken);
  const pendingChange = useGetPendingChangeQuery(
    data && data.replaces_id === null && (data.status === "pending" || data.status === "confirmed") ? bookingId : skipToken,
  );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Бронь</SheetTitle>
          <SheetDescription>Заявка на столик и решение по ней</SheetDescription>
        </SheetHeader>
        {booking.error ? (
          <div className="p-4">
            <LoadError error={booking.error} onRetry={booking.refetch} />
          </div>
        ) : !data ? (
          <Skeleton className="m-4 h-48" />
        ) : (
          <BookingDetails
            booking={data}
            original={original.data ?? null}
            pendingChange={pendingChange.data ?? null}
            timeZone={timeZone}
            search={search}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function BookingDetails({
  booking,
  original,
  pendingChange,
  timeZone,
  search,
}: {
  booking: BookingRequest;
  original: BookingRequest | null;
  pendingChange: BookingRequest | null;
  timeZone: string;
  search: BookingsSearch;
}) {
  const now = useNow();
  const [setStatus, { isLoading }] = useSetBookingStatusMutation();
  const [confirming, setConfirming] = useState<BookingAction | null>(null);

  const status = isBookingStatus(booking.status) ? booking.status : null;
  const actions = status ? allowedBookingActions({ ...booking, status }, now) : [];

  async function run(action: BookingAction) {
    // from — статус, который менеджер видит на экране: RPC откажет, если он успел измениться.
    const result = await setStatus({ id: booking.id, from: booking.status, to: action.to });
    if (result.error) toast.error(result.error.message ?? "Не удалось сохранить");
    else toast.success(`Статус: ${statusAfter(action.to)}`);
  }

  return (
    <div className="space-y-4 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <BookingStatusBadge status={booking.status} />
        {booking.replaces_id && <Badge variant="outline">запрос на изменение</Badge>}
        {managerNotificationFailed(booking, now) && (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            уведомление менеджеру не доставлено
          </Badge>
        )}
        {status && guestNotificationFailed({ ...booking, status }, now) && (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            гость не уведомлён
          </Badge>
        )}
      </div>

      <dl className="space-y-3 text-sm">
        {original ? (
          <>
            <Field label="Было">
              {formatInZone(original.booking_at, timeZone)}, {guestsLabel(original.guests_count)}
            </Field>
            <Field label="Станет">
              {formatInZone(booking.booking_at, timeZone)}, {guestsLabel(booking.guests_count)}
            </Field>
          </>
        ) : (
          <>
            <Field label="Когда">{formatInZone(booking.booking_at, timeZone)}</Field>
            <Field label="Гостей">{guestsLabel(booking.guests_count)}</Field>
          </>
        )}
        <Field label="Имя">{booking.guest_name}</Field>
        <Field label="Контакт">
          <ContactValue contact={booking.contact} />
        </Field>
        <Field label="Комментарий">{booking.comment ?? "—"}</Field>
        <Field label="Создана">{formatInZone(booking.created_at, timeZone)}</Field>
        <Field label="Обновлена">{formatInZone(booking.updated_at, timeZone)}</Field>
      </dl>

      <OpenConversationLink conversationId={booking.conversation_id} />

      {pendingChange && (
        <p className="rounded-md border border-amber-500/50 p-3 text-sm">
          Есть ожидающий запрос на изменение:{" "}
          <Link
            to="/bookings/$bookingId"
            params={{ bookingId: pendingChange.id }}
            search={search}
            className="underline underline-offset-2"
          >
            {formatInZone(pendingChange.booking_at, timeZone)}, {guestsLabel(pendingChange.guests_count)}
          </Link>
        </p>
      )}

      {actions.length > 0 && (
        <SheetFooter className="flex-row flex-wrap gap-2 p-0">
          {actions.map((action) => (
            <div key={action.to} className="space-y-1">
              <Button
                variant={action.to === "confirmed" ? "default" : "outline"}
                disabled={isLoading || action.disabledReason !== null}
                onClick={() => (action.needsConfirm ? setConfirming(action) : void run(action))}
              >
                {action.label}
              </Button>
              {action.disabledReason && <p className="max-w-56 text-xs text-muted-foreground">{action.disabledReason}</p>}
            </div>
          ))}
        </SheetFooter>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming && consequence(confirming, booking, original, timeZone)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Назад</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirming;
                setConfirming(null);
                if (action) void run(action);
              }}
            >
              {confirming?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const AFTER: Record<BookingStatus, string> = {
  pending: "ожидает",
  confirmed: "подтверждена",
  declined: "отклонена",
  cancelled: "отменена",
};
const statusAfter = (to: string) => (isBookingStatus(to) ? AFTER[to] : to);

/** Что произойдёт после подтверждения: диалог называет последствие, а не просто переспрашивает. */
function consequence(action: BookingAction, booking: BookingRequest, original: BookingRequest | null, timeZone: string): string {
  if (action.to === "confirmed" && booking.replaces_id) {
    const was = original ? ` на ${formatInZone(original.booking_at, timeZone)}` : "";
    return `Исходная бронь${was} будет отменена, её заменит эта. Гость получит сообщение в Telegram.`;
  }
  if (action.to === "declined") return "Заявка будет отклонена. Гость получит сообщение в Telegram. Действие нельзя отменить.";
  return "Бронь будет отменена. Гость получит сообщение в Telegram. Действие нельзя отменить.";
}
