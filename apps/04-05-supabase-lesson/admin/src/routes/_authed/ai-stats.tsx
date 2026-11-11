import { createFileRoute } from "@tanstack/react-router";
import { AiStatsScreen } from "@/features/ai-stats/AiStatsScreen";

export const Route = createFileRoute("/_authed/ai-stats")({ component: AiStatsScreen });
