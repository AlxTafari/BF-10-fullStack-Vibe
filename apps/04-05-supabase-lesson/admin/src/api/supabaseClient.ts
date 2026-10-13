import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (см. admin/.env.example)");
}

// Только anon-ключ: он публичный, права ограничивает RLS. Токены сессии supabase-js хранит и обновляет сам.
export const supabase = createClient<Database>(url, anonKey);
