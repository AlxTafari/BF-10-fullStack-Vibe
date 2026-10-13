import { createClient } from "@supabase/supabase-js";
import { createRefreshingFetch } from "@/domain/refreshingFetch";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (см. admin/.env.example)");
}

// Протухшая сессия посреди работы: PostgREST отвечает 401 → один тихий refresh и повтор запроса.
// Не вышло — локальный выход: SIGNED_OUT сбрасывает кэш и уводит на /login с возвратом на текущий адрес.
// `supabase` здесь используется лениво (внутри колбэков), к моменту первого запроса он уже создан.
const refreshingFetch = createRefreshingFetch({
  fetchImpl: (input, init) => fetch(input, init),
  refresh: async () => {
    const { data, error } = await supabase.auth.refreshSession();
    return error || !data.session ? null : data.session.access_token;
  },
  onSessionLost: async () => {
    await supabase.auth.signOut({ scope: "local" });
  },
  // Только данные (/rest/v1/…): запросы самого Auth refresh использует сам, их повтор дал бы взаимную блокировку.
  shouldRetry: (requestUrl) => requestUrl.includes("/rest/v1/"),
});

// Только anon-ключ: он публичный, права ограничивает RLS. Токены сессии supabase-js хранит и обновляет сам.
export const supabase = createClient<Database>(url, anonKey, { global: { fetch: refreshingFetch } });
