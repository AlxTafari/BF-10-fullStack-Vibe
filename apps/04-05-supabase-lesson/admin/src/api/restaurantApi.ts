import type { RestaurantRecord, RestaurantUpdate } from "@/domain/restaurantSchema";
import { baseApi } from "./baseApi";
import { toApiError } from "./errors";
import { supabase } from "./supabaseClient";

// Поля, которые нужны экрану. Остальные (id, created_at …) форме ни к чему.
const COLUMNS =
  "name, description, address, phone, email, timezone, currency, working_hours, opening_hours, manager_chat_id";

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
  }),
});

export const { useGetRestaurantQuery, useUpdateRestaurantMutation } = restaurantApi;
