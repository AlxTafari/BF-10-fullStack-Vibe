// Контакт гостя из черновика агента (S09). Чистая функция: без БД и Telegram.
// Модель не знает @username гостя: на «свяжитесь по Телеграму» она подставляла шаблон «@username», проверка формата
// его пропускала, и заявка уходила ресторану с недостижимым контактом. Поэтому «мой Telegram» — отдельный признак
// useTelegram, а сам @username берёт сервер из апдейта (как кнопка «Использовать Telegram»).
import { telegramFill } from "./bookingFlow.ts";
import { validateContact } from "./fieldValidation.ts";
import type { DraftError, FlowEnv } from "./flowState.ts";

/**
 * Шаблоны, которые модель пишет вместо настоящего ника. Формат у них валидный, поэтому — отдельный список.
 * Настоящий гость с таким ником (если он есть) получит ошибку и нажмёт кнопку «Использовать Telegram».
 */
const PLACEHOLDER_CONTACTS = new Set(["@username", "@user_name", "@yourusername", "@your_username", "@telegram", "@nickname", "@login"]);

/** none — агент контакт не передавал; ok — контакт для черновика; error — не принят (код уходит модели). */
export type AgentContact = { kind: "none" } | { kind: "ok"; value: string } | { kind: "error"; error: DraftError };

/**
 * useTelegram важнее contact: если модель передала и признак, и (шаблонный) ник, верим признаку.
 * У гостя нет @username — no_telegram_username: модель спросит телефон.
 */
export function resolveAgentContact(input: { contact?: string; useTelegram?: boolean }, env: FlowEnv): AgentContact {
  if (input.useTelegram === true) {
    const tg = telegramFill(env);
    return tg ? { kind: "ok", value: `@${tg.username}` } : { kind: "error", error: "no_telegram_username" };
  }
  if (input.contact === undefined) return { kind: "none" };
  const v = validateContact(input.contact);
  if (!v.ok) return { kind: "error", error: v.error };
  if (PLACEHOLDER_CONTACTS.has(v.value.toLowerCase())) return { kind: "error", error: "contact_placeholder" };
  return { kind: "ok", value: v.value };
}
