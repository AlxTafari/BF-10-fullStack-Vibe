// Тестовый гость для сценарных тестов (S07): строит апдейты Telegram, гонит их через настоящий роутер и убирает
// за собой всё, что создал в dev-БД.
//
// Отрицательные id — граница между тестом и реальностью: у настоящих пользователей Telegram и у настоящих апдейтов
// id положительные, поэтому cleanup() не может задеть живого гостя или чужой апдейт.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmClient } from "../../_shared/services/ai/agent.ts";
import type { InlineKeyboardButton, TelegramUpdate } from "../../_shared/telegram/types.ts";
import { routeUpdate } from "../router.ts";
import type { FakeMessage, FakeTelegram } from "./fakeTelegram.ts";

export interface TestGuest {
  /** id гостя в Telegram; в личном чате совпадает с chat_id. */
  readonly id: number;
  /** Текст от гостя. Возвращает update_id — чтобы проверить повторную доставку того же апдейта. */
  text(text: string): Promise<number>;
  /** Нажатие кнопки с данным callback_data под сообщением messageId (по умолчанию — под последним). */
  tap(callbackData: string, messageId?: number): Promise<number>;
  /** Нажатие первой кнопки на экране гостя, чья callback_data подходит под условие. Нет такой — ошибка. */
  tapWhere(match: (button: InlineKeyboardButton) => boolean): Promise<number>;
  /** Повторная доставка уже отправленного апдейта (Telegram ретраит при таймауте). */
  redeliver(updateId: number): Promise<void>;
  /** Текущий экран: самое нижнее сообщение в чате гостя. */
  screen(): FakeMessage;
  /** Все видимые сообщения в чате гостя. */
  messages(): FakeMessage[];
  conversationId(): Promise<string>;
  cleanup(): Promise<void>;
}

/** Случайное отрицательное число, не пересекающееся с id, которые уже используют другие интеграционные тесты. */
function negativeId(): number {
  return -Math.floor(Math.random() * 1_000_000_000) - 2_000_000;
}

export function createTestGuest(
  client: SupabaseClient,
  tg: FakeTelegram,
  // llm — фейковая модель для сценариев AI (S09); без неё свободный текст идёт в поиск блюда, как до S09.
  options: { username?: string; firstName?: string; llm?: LlmClient } = {},
): TestGuest {
  const id = negativeId();
  const from = { id, is_bot: false, first_name: options.firstName ?? "Тест", username: options.username };
  const chat = { id, type: "private" };
  // Свой диапазон update_id на гостя: параллельные тесты не сталкиваются в processed_updates.
  const updateBase = negativeId() * 1000;
  let seq = 0;
  const sent = new Map<number, TelegramUpdate>();
  const updateIds: number[] = [];

  async function deliver(build: (updateId: number) => TelegramUpdate): Promise<number> {
    const updateId = updateBase - seq++;
    const update = build(updateId);
    sent.set(updateId, update);
    updateIds.push(updateId);
    await routeUpdate({ client, tg, llm: options.llm ?? null }, update);
    return updateId;
  }

  function screen(): FakeMessage {
    return tg.last(id);
  }

  async function tap(callbackData: string, messageId?: number): Promise<number> {
    // Чат пуст (первое действие теста) — кнопка как будто под старым, уже удалённым сообщением: id 0 в чате нет.
    const target = messageId ?? tg.messages(id).at(-1)?.messageId ?? 0;
    return await deliver((updateId) => ({
      update_id: updateId,
      callback_query: {
        id: `cq${updateId}`,
        from,
        data: callbackData,
        message: { message_id: target, chat },
      },
    }));
  }

  async function conversationIds(): Promise<string[]> {
    const { data, error } = await client.from("conversations").select("id").eq("external_user_id", id);
    if (error) throw error;
    return (data ?? []).map((r) => r.id as string);
  }

  return {
    id,
    text: (text) =>
      deliver((updateId) => ({
        update_id: updateId,
        message: { message_id: updateId, from, chat, text },
      })),
    tap,
    async tapWhere(match) {
      // Ищем снизу вверх: кнопка на нижнем экране важнее такой же на старом сообщении.
      for (const message of tg.messages(id).reverse()) {
        const button = message.keyboard.flat().find(match);
        if (button) return await tap(button.callback_data, message.messageId);
      }
      throw new Error(`нет подходящей кнопки на экране гостя:\n${screen().text}`);
    },
    async redeliver(updateId) {
      const update = sent.get(updateId);
      if (!update) throw new Error(`апдейт ${updateId} этим гостем не отправлялся`);
      await routeUpdate({ client, tg, llm: options.llm ?? null }, update);
    },
    screen,
    messages: () => tg.messages(id),
    async conversationId() {
      const [first] = await conversationIds();
      if (!first) throw new Error("диалог гостя ещё не создан");
      return first;
    },
    async cleanup() {
      const ids = await conversationIds();
      if (ids.length > 0) {
        // Заявки бессрочны (S06c), но эти — тестовые и принадлежат гостю с отрицательным id. Удаляем до диалога:
        // иначе on delete set null оставил бы их сиротами в админке.
        for (const table of ["booking_requests", "guest_requests"]) {
          const { error } = await client.from(table).delete().in("conversation_id", ids);
          if (error) throw error;
        }
        const { error } = await client.from("conversations").delete().in("id", ids); // messages — каскадом
        if (error) throw error;
      }
      await client.from("rate_limits").delete().eq("external_user_id", id);
      if (updateIds.length > 0) await client.from("processed_updates").delete().in("update_id", updateIds);
    },
  };
}
