// Критерий §10 «в ответах гостю нет внутренних данных ресторана» (S07 §2.Б.3). Проверка общая для всех
// сценариев: прогоняется по каждому тексту и каждой подписи кнопки, которые бот отправил гостю.
import type { FakeTelegram } from "./fakeTelegram.ts";

// UUID — id блюд, заявок, диалогов. Им место только в callback_data, гость её не видит.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;
// Следы пропущенного поля при сборке строки.
const LEAKED_VALUE = /\b(undefined|null|NaN)\b|\[object Object\]/;
// Имена колонок БД в тексте — признак, что наружу ушла сырая строка или отладочный вывод.
const DB_FIELD = /\b(external_user_id|restaurant_id|conversation_id|manager_chat_id|idempotency_key|replaces_id|is_published)\b/;

export interface InternalsContext {
  /** Чат менеджера — его номер гость не должен увидеть ни в каком виде. */
  managerChatId: number | null;
  /** Названия неопубликованных блюд: они не должны покидать БД. */
  hiddenDishNames: string[];
}

/** Тексты, которые видел гость: сообщения и правки в его чате, подписи их кнопок, всплывашки на нажатия. */
export function guestVisibleTexts(tg: FakeTelegram, guestChatId: number): string[] {
  const texts: string[] = [];
  for (const call of tg.calls) {
    // answerCallbackQuery не несёт chatId, но в тесте нажимает только гость.
    const toGuest = call.chatId === guestChatId || call.method === "answerCallbackQuery";
    if (!toGuest) continue;
    if (call.text) texts.push(call.text);
    for (const button of call.keyboard?.flat() ?? []) texts.push(button.text);
  }
  return texts;
}

/** Список нарушений; пустой — всё чисто. Возвращаем список, а не бросаем на первом: в отчёте видно всё сразу. */
export function findInternals(texts: string[], ctx: InternalsContext): string[] {
  const problems: string[] = [];
  for (const text of texts) {
    if (UUID.test(text)) problems.push(`UUID: ${text}`);
    if (LEAKED_VALUE.test(text)) problems.push(`пропущенное значение: ${text}`);
    if (DB_FIELD.test(text)) problems.push(`имя поля БД: ${text}`);
    if (ctx.managerChatId !== null && text.includes(String(ctx.managerChatId))) problems.push(`chat_id менеджера: ${text}`);
    for (const name of ctx.hiddenDishNames) {
      if (text.toLowerCase().includes(name.toLowerCase())) problems.push(`неопубликованное блюдо «${name}»: ${text}`);
    }
  }
  return problems;
}
