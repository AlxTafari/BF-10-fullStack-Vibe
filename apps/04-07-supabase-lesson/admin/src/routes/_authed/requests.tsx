import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { type GuestRequestsSearch, guestRequestsSearchSchema } from "@/domain/requestLists";
import { GuestRequestsScreen } from "@/features/requests/GuestRequestsScreen";

export const Route = createFileRoute("/_authed/requests")({
  validateSearch: (search: Partial<GuestRequestsSearch> & SearchSchemaInput): GuestRequestsSearch =>
    guestRequestsSearchSchema.parse(search),
  component: GuestRequestsScreen,
});
