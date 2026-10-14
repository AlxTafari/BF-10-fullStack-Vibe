import { toast } from "sonner";
import { type GuestRequest, useGetGuestRequestQuery, useSetGuestRequestStatusMutation } from "@/api/requestsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { type GuestRequestStatus, allowedGuestRequestActions } from "@/domain/guestRequestStatus";
import { managerNotificationFailed } from "@/domain/bookingStatus";
import { formatInZone } from "@/domain/time";
import { LoadError } from "@/features/common/LoadError";
import { useNow } from "@/features/common/useNow";
import { ContactValue } from "./ContactValue";
import { GuestRequestStatusBadge, kindLabel } from "./StatusBadges";

interface Props {
  requestId: string;
  timeZone: string;
  onClose: () => void;
}

export function GuestRequestSheet({ requestId, timeZone, onClose }: Props) {
  const request = useGetGuestRequestQuery(requestId);
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Обращение</SheetTitle>
          <SheetDescription>Отзыв, жалоба или вопрос гостя</SheetDescription>
        </SheetHeader>
        {request.error ? (
          <div className="p-4">
            <LoadError error={request.error} onRetry={request.refetch} />
          </div>
        ) : !request.data ? (
          <Skeleton className="m-4 h-48" />
        ) : (
          <Details request={request.data} timeZone={timeZone} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({ request, timeZone }: { request: GuestRequest; timeZone: string }) {
  const now = useNow();
  const [setStatus, { isLoading }] = useSetGuestRequestStatusMutation();
  const known = ["new", "in_progress", "resolved"].includes(request.status);
  const actions = known ? allowedGuestRequestActions(request.status as GuestRequestStatus) : [];

  async function run(to: GuestRequestStatus) {
    // Деструктивных переходов нет — подтверждающий диалог не нужен.
    const result = await setStatus({ id: request.id, from: request.status, to });
    if (result.error) toast.error(result.error.message ?? "Не удалось сохранить");
  }

  return (
    <div className="space-y-4 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{kindLabel(request.kind)}</Badge>
        <GuestRequestStatusBadge status={request.status} />
        {managerNotificationFailed(request, now) && (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            уведомление менеджеру не доставлено
          </Badge>
        )}
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Текст</dt>
          {/* Пишет гость: только как текст, переносы строк сохраняем, длинные слова переносим. */}
          <dd className="break-words whitespace-pre-wrap">{request.text}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Контакт</dt>
          <dd className="break-words">
            <ContactValue contact={request.contact} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Создано</dt>
          <dd>{formatInZone(request.created_at, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Обновлено</dt>
          <dd>{formatInZone(request.updated_at, timeZone)}</dd>
        </div>
      </dl>
      {actions.length > 0 && (
        <SheetFooter className="flex-row flex-wrap gap-2 p-0">
          {actions.map((a) => (
            <Button key={a.to} variant={a.to === "resolved" ? "default" : "outline"} disabled={isLoading} onClick={() => void run(a.to)}>
              {a.label}
            </Button>
          ))}
        </SheetFooter>
      )}
    </div>
  );
}
