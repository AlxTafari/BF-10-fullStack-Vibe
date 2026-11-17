import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/requests/$requestId")({ component: () => null });
