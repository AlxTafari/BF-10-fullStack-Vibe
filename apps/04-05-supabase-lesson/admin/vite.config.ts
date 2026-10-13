import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Интеграционный RLS-тест (tests/) берёт URL и ключи из .env в корне приложения — рядом с ботом.
// В бандл браузера они не попадают: туда идут только VITE_*-переменные из admin/.env.local.
const TEST_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

export default defineConfig(({ mode }) => {
  const all = loadEnv(mode, path.resolve(import.meta.dirname, ".."), "");
  const testEnv = Object.fromEntries(TEST_ENV_KEYS.flatMap((key) => (all[key] ? [[key, all[key]]] : [])));

  return {
    plugins: [
      // Плагин роутера — строго ДО react(): иначе генерация маршрутов молча не сработает.
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
    test: { environment: "node", include: ["src/**/*.test.ts", "tests/**/*.test.ts"], env: testEnv },
  };
});
