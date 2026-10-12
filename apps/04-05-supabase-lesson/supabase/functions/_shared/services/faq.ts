import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getPublishedFaq, listPublishedFaq } from "../repositories/faqRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";

export interface FaqListItem {
  id: string;
  question: string;
}

export interface FaqAnswer {
  question: string;
  answer: string;
}

/** Сервисы ядра (ADR-004): без Telegram и AI; в S09 станут tools для LLM. */
export async function listFaq(client: SupabaseClient): Promise<FaqListItem[]> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) return [];
  const rows = await listPublishedFaq(client, restaurant.id);
  return rows.map(({ id, question }) => ({ id, question }));
}

/** Скрытый или несуществующий вопрос — null. */
export async function getFaqAnswer(client: SupabaseClient, input: { faqId: string }): Promise<FaqAnswer | null> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) return null;
  const row = await getPublishedFaq(client, restaurant.id, input.faqId);
  return row ? { question: row.question, answer: row.answer } : null;
}
