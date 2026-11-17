import { createFileRoute } from "@tanstack/react-router";
import { FaqScreen } from "@/features/faq/FaqScreen";

export const Route = createFileRoute("/_authed/faq")({ component: FaqScreen });
