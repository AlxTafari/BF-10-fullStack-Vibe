import type { AiSettingsRecord } from "@/domain/aiSettingsSchema";
import type { RestaurantRecord, RestaurantUpdate } from "@/domain/restaurantSchema";
import { baseApi } from "./baseApi";
import { toApiError } from "./errors";
import { supabase } from "./supabaseClient";

// Поля, которые нужны экрану. Остальные (id, created_at …) форме ни к чему.
const COLUMNS =
  "name, description, address, phone, email, timezone, currency, working_hours, opening_hours, manager_chat_id";
const AI_COLUMNS = "ai_enabled, history_window, daily_turn_limit";

export const restaurantApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    // restaurantId берём из getMe; RLS всё равно отдаст только «свой» ресторан.
    getRestaurant: build.query<RestaurantRecord, string>({
      queryFn: async (restaurantId) => {
        const { data, error } = await supabase.from("restaurants").select(COLUMNS).eq("id", restaurantId).single();
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: ["Restaurant"],
    }),

    // Пессимистичное сохранение: ждём ответ БД. id подставляется явно — `with check` в БД страхует.
    updateRestaurant: build.mutation<RestaurantRecord, { restaurantId: string; patch: RestaurantUpdate }>({
      queryFn: async ({ restaurantId, patch }) => {
        const { data, error } = await supabase
          .from("restaurants")
          .update(patch)
          .eq("id", restaurantId)
          .select(COLUMNS)
          .single();
        return error ? { error: toApiError(error) } : { data };
      },
      invalidatesTags: ["Restaurant"],
    }),

    // Настройки AI-помощника (S09): строка restaurant_ai_settings создаётся триггером вместе с рестораном,
    // поэтому только select и update (insert / delete политиками закрыты).
    getAiSettings: build.query<AiSettingsRecord, string>({
      queryFn: async (restaurantId) => {
        const { data, error } = await supabase.from("restaurant_ai_settings").select(AI_COLUMNS).eq("restaurant_id", restaurantId).single();
        return error ? { error: toApiError(error) } : { data };
      },
      providesTags: ["AiSettings"],
    }),

    // Пессимистично, как ресторан. Значение вне диапазона отклонит check в БД — ошибка уйдёт в форму.
    updateAiSettings: build.mutation<AiSettingsRecord, { restaurantId: string; patch: AiSettingsRecord }>({
      queryFn: async ({ restaurantId, patch }) => {
        const { data, error } = await supabase
          .from("restaurant_ai_settings")
          .update(patch)
          .eq("restaurant_id", restaurantId)
          .select(AI_COLUMNS)
          .single();
        return error ? { error: toApiError(error) } : { data };
      },
      invalidatesTags: ["AiSettings"],
    }),
  }),
});

export const { useGetRestaurantQuery, useUpdateRestaurantMutation, useGetAiSettingsQuery, useUpdateAiSettingsMutation } = restaurantApi;
