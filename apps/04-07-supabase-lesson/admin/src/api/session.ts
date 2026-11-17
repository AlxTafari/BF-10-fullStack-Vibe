import { baseApi } from "./baseApi";
import { signedIn, signedOut } from "./authSlice";
import { store } from "./store";
import { supabase } from "./supabaseClient";

/** Есть ли сессия прямо сейчас. Источник правды для guard'а маршрутов (beforeLoad). */
export async function hasSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return data.session !== null;
}

let started = false;

/**
 * Подписка на события Auth — один раз при старте приложения. Приводит slice в соответствие
 * с реальной сессией: вход, выход в другой вкладке, протухший refresh-токен.
 */
export function startAuthListener(): void {
  if (started) return;
  started = true;
  // Колбэк не async и не await'ит supabase-вызовы: иначе возможна взаимная блокировка внутри supabase-js.
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      store.dispatch(signedIn({ email: session.user.email ?? null }));
      return;
    }
    store.dispatch(signedOut());
    // Данные прошлого менеджера не должны остаться в памяти.
    if (event === "SIGNED_OUT") store.dispatch(baseApi.util.resetApiState());
  });
}
