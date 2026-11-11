import type { AiUsageDay } from "@/domain/aiUsage";
import { baseApi } from "./baseApi";
import { toApiError } from "./errors";
import { supabase } from "./supabaseClient";

// Статистика AI (S09): суммы по дням и моделям считает БД (RPC ai_usage_daily, под RLS), стоимость — domain/aiUsage.
export const aiStatsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // Границы [from, to) считает экран в поясе ресторана (domain/aiUsage.periodRange).
    getAiUsage: build.query<AiUsageDay[], { from: string; to: string }>({
      queryFn: async ({ from, to }) => {
        const { data, error } = await supabase.rpc("ai_usage_daily", { p_from: from, p_to: to });
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: ["AiUsage"],
    }),
  }),
});

export const { useGetAiUsageQuery } = aiStatsApi;
