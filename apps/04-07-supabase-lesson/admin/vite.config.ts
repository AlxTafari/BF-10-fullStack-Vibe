import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Интеграционный RLS-тест (tests/) берёт URL и ключи из .env в корне приложения — рядом с ботом.
// В бандл браузера они не попадают: туда идут только VITE_*-переменные из admin/.env.local.
const TEST_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

// CSP для GitHub Pages (S08). Pages не умеет отдавать свои заголовки ответа, поэтому политика едет
// тегом <meta http-equiv> в index.html. Ограничение meta: браузер игнорирует в нём frame-ancestors
// (и X-Frame-Options тегом не задаётся), так что защиты от встраивания во фрейм нет — разбор в
// docs/guides/ci-cd/06-spa-hosting-and-csp.md.
// Адрес Supabase берётся из VITE_SUPABASE_URL той же сборки, поэтому ref проекта в репозитории не нужен.
// Без VITE_SUPABASE_URL (job checks в CI) тег не добавляется: сборка проверяет только код, а деплой
// отдельным шагом убеждается, что CSP в dist/index.html на месте.
function cspMeta(supabaseUrl: string | undefined): Plugin {
  return {
    name: "csp-meta",
    apply: "build",
    transformIndexHtml() {
      if (!supabaseUrl) {
        this.warn("VITE_SUPABASE_URL не задан — CSP в index.html не добавлен");
        return;
      }
      // origin без пути: https://<ref>.supabase.co. Для Realtime тот же хост, схема wss (локально http → ws).
      const http = new URL(supabaseUrl).origin;
      const ws = http.replace(/^http/, "ws");
      const policy = [
        "default-src 'self'",
        // Без 'unsafe-inline' и 'unsafe-eval' — ради этого CSP и делается (роадмап §3.2).
        "script-src 'self'",
        // sonner вставляет свои стили элементом <style> из JS — без 'unsafe-inline' тосты без стилей.
        "style-src 'self' 'unsafe-inline'",
        `connect-src 'self' ${http} ${ws}`,
        "img-src 'self' data: https:",
        // Голосовые гостя (S09): плеер играет blob:-URL, собранный из ответа manager-chat. Без директивы действует
        // default-src 'self', и <audio> молча не грузит blob: (скачивание по той же ссылке при этом работает).
        // blob: создаёт только код этой страницы на своём origin — внешний адрес через него не загрузить.
        "media-src 'self' blob:",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");
      // head-prepend: политика должна стоять раньше любых <script> и <link>, иначе они загрузятся без неё.
      return [
        { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const all = loadEnv(mode, path.resolve(import.meta.dirname, ".."), "");
  const testEnv = Object.fromEntries(TEST_ENV_KEYS.flatMap((key) => (all[key] ? [[key, all[key]]] : [])));
  // VITE_* — как их видит сам Vite: admin/.env* и переменные окружения процесса (в CI — из GitHub Variables).
  const clientEnv = loadEnv(mode, import.meta.dirname, "VITE_");

  return {
    // GitHub Pages раздаёт сайт проекта из подпапки: https://<владелец>.github.io/<репозиторий>/.
    // CI передаёт её в ADMIN_BASE_PATH, локально — корень. Vite подставляет base в пути к ассетам,
    // а роутер берёт тот же путь из import.meta.env.BASE_URL (main.tsx).
    base: process.env.ADMIN_BASE_PATH || "/",
    plugins: [
      // Плагин роутера — строго ДО react(): иначе генерация маршрутов молча не сработает.
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      cspMeta(clientEnv.VITE_SUPABASE_URL),
    ],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
      env: testEnv,
      // Интеграционные файлы tests/ делят одну dev-БД (ресторан, менеджер, заявки) и при параллельном запуске
      // мешали друг другу (S07). Файлы идут по очереди; юнит-тесты src/ быстрые, на общем времени это почти не видно.
      // Отдельная БД на прогон — S08.
      fileParallelism: false,
    },
  };
});
