// Клиент модели из секретов Supabase (S09). Живёт в services, а не в обработчике: обработчики не импортируют
// llm/ (ADR-008, check:layers) — index.ts берёт готового клиента отсюда, как берёт клиента Telegram.
import { createGeminiClient } from "../../llm/gemini.ts";
import type { LlmClient } from "../../llm/types.ts";

/**
 * GEMINI_API_KEY и GEMINI_MODEL — секреты (`supabase secrets set`), модель меняется без деплоя кода.
 * Чего-то нет — null: бот работает, свободный текст получает запасной ответ с кнопками, в лог — предупреждение.
 */
export function createLlmFromEnv(): LlmClient | null {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL");
  if (!apiKey || !model) {
    console.error("GEMINI_API_KEY или GEMINI_MODEL не заданы — AI-ответы недоступны");
    return null;
  }
  return createGeminiClient(apiKey, model);
}
