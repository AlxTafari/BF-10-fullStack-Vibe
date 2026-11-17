import { createFileRoute } from "@tanstack/react-router";
import { RestaurantScreen } from "@/features/restaurant/RestaurantScreen";

export const Route = createFileRoute("/_authed/restaurant")({ component: RestaurantScreen });
