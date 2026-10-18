import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseLastNav, type LastNav } from "../domain/navigation.ts";
import { casFaqAnswer, casLastNav, fetchLastNav } from "../repositories/conversationsRepo.ts";

/** Запоминает навигационное сообщение, если «последним» всё ещё числится `expected`. false — опередил параллельный апдейт. */
export function rememberNav(
  client: SupabaseClient,
  input: { conversationId: string; expected: number | null; screen: string; messageId: number },
): Promise<boolean> {
  return casLastNav(client, input);
}

/** Актуальное «последнее навигационное сообщение» из БД. */
export async function reloadLastNav(client: SupabaseClient, conversationId: string): Promise<LastNav | null> {
  return parseLastNav(await fetchLastNav(client, conversationId));
}

/**
 * Запоминает новый ответ FAQ и возвращает message_id предыдущих ответов (с них снимаем клавиатуру; обычно один или ни одного).
 * CAS проигран (параллельный ответ записался раньше) — повторяем от актуального значения: итог один и тот же,
 * клавиатура остаётся только у последнего записавшегося, а снять её надо со всех предыдущих.
 */
export async function rememberFaqAnswer(
  client: SupabaseClient,
  input: { conversationId: string; expected: number | null; messageId: number },
): Promise<number[]> {
  const toClear: number[] = [];
  let expected = input.expected;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await casFaqAnswer(client, { ...input, expected });
    if (result.previousId !== null) toClear.push(result.previousId);
    if (result.swapped) return [...new Set(toClear)];
    expected = result.previousId;
  }
  return [...new Set(toClear)];
}
