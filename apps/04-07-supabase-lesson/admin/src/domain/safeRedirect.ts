/**
 * Куда вернуть пользователя после входа. Параметр `redirect` приходит из URL, то есть от кого угодно,
 * поэтому пускаем только относительный путь внутри админки (защита от open-redirect).
 */
export function safeRedirect(target: unknown, fallback = "/"): string {
  if (typeof target !== "string") return fallback;
  // Только путь, начинающийся с одного «/»: «//evil.com» и «/\evil.com» браузер считает внешним адресом.
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return fallback;
  // Управляющие символы (перевод строки и т.п.) и обратный слэш — приёмы обхода проверок.
  for (const ch of target) {
    if (ch.charCodeAt(0) < 0x20 || ch === "\\") return fallback;
  }
  // Возврат на /login после входа зациклил бы пользователя.
  if (target === "/login" || target.startsWith("/login?") || target.startsWith("/login/")) return fallback;
  return target;
}
