import { baseApi } from "./baseApi";
import { toApiError } from "./errors";
import { supabase } from "./supabaseClient";

// Одно общее сообщение: не различаем «нет такого пользователя» и «неверный пароль».
const INVALID_CREDENTIALS = "Неверный email или пароль";
const NETWORK_ERROR = "Нет соединения с сервером. Попробуйте ещё раз";

export interface Me {
  /** null — аккаунт есть, но менеджером ресторана он не назначен. */
  restaurantId: string | null;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    signIn: build.mutation<null, { email: string; password: string }>({
      queryFn: async ({ email, password }) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (!error) return { data: null };
        // Сетевой сбой — не «неверный пароль»: человек не должен менять пароль из-за обрыва связи.
        const message = error.name === "AuthRetryableFetchError" ? NETWORK_ERROR : INVALID_CREDENTIALS;
        return { error: { message, code: error.code } };
      },
    }),

    signOut: build.mutation<null, void>({
      queryFn: async () => {
        const { error } = await supabase.auth.signOut();
        return error ? { error: toApiError(error) } : { data: null };
      },
    }),

    // Менеджер ли пользователь: RLS отдаёт ему только его строку, у постороннего её нет.
    getMe: build.query<Me, void>({
      queryFn: async () => {
        const { data, error } = await supabase.from("restaurant_managers").select("restaurant_id").maybeSingle();
        if (error) return { error: toApiError(error) };
        return { data: { restaurantId: data?.restaurant_id ?? null } };
      },
    }),
  }),
});

export const { useSignInMutation, useSignOutMutation, useGetMeQuery } = authApi;
