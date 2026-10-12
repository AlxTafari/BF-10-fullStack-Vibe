import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { RestaurantInfo } from "../domain/formatRestaurantInfo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";

/**
 * Сервис ядра (ADR-004): не знает ни про Telegram, ни про AI. Сейчас его зовёт обработчик
 * кнопки «О ресторане»; в S09 та же функция станет tool для LLM.
 * Возвращает только гостевые поля — внутренние данные наружу не уходят.
 */
export async function getRestaurantInfo(client: SupabaseClient): Promise<RestaurantInfo | null> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) return null;
  const { name, description, address, phone, working_hours } = restaurant;
  return { name, description, address, phone, working_hours };
}
