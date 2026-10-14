import { Badge } from "@/components/ui/badge";
import { BOOKING_STATUS_LABEL, type BookingStatus, isBookingStatus } from "@/domain/bookingStatus";
import {
  GUEST_REQUEST_KIND_LABEL,
  GUEST_REQUEST_STATUS_LABEL,
  type GuestRequestKind,
  type GuestRequestStatus,
} from "@/domain/guestRequestStatus";

const BOOKING_VARIANT: Record<BookingStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  confirmed: "default",
  declined: "destructive",
  cancelled: "outline",
};

export function BookingStatusBadge({ status }: { status: string }) {
  if (!isBookingStatus(status)) return <Badge variant="outline">{status}</Badge>;
  return <Badge variant={BOOKING_VARIANT[status]}>{BOOKING_STATUS_LABEL[status]}</Badge>;
}

const GUEST_VARIANT: Record<GuestRequestStatus, "default" | "secondary" | "outline"> = {
  new: "default",
  in_progress: "secondary",
  resolved: "outline",
};

export function GuestRequestStatusBadge({ status }: { status: string }) {
  const known = status in GUEST_REQUEST_STATUS_LABEL;
  if (!known) return <Badge variant="outline">{status}</Badge>;
  const s = status as GuestRequestStatus;
  return <Badge variant={GUEST_VARIANT[s]}>{GUEST_REQUEST_STATUS_LABEL[s]}</Badge>;
}

export function kindLabel(kind: string): string {
  return GUEST_REQUEST_KIND_LABEL[kind as GuestRequestKind] ?? kind;
}
