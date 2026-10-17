import type { OpeningHours } from "./domain/bookingRules.ts";

export type MessageDirection = "in" | "out";
/** text — обычное сообщение, button — нажатие inline-кнопки (текст остаётся «[кнопка] …»). */
export type MessageKind = "text" | "button";

export interface RestaurantRow {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  // ISO 4217 (EUR, RUB…): одна валюта на всё меню.
  currency: string;
  working_hours: string | null;
  // Только для сервера: гостю не отдаются (getRestaurantInfo берёт явный список полей).
  manager_chat_id: number | null;
  opening_hours: OpeningHours | null;
}

export interface ConversationRow {
  id: string;
  restaurant_id: string;
  channel: string;
  external_user_id: number;
  chat_id: number;
  display_name: string | null;
  // Состояние пошагового сценария (бронь, обращение), {} = нет сценария. Разбирается через parseFlowState.
  state: Record<string, unknown>;
  last_message_at: string | null;
}

export interface FaqRow {
  id: string;
  question: string;
  answer: string;
}

export interface MenuCategoryRow {
  id: string;
  name: string;
}

// Только гостевые поля карточки: external_id, source, restaurant_id и прочее внутреннее репозиторий не выбирает.
export interface MenuItemRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  ingredients: string | null;
  // null = не указано, [] = указано «аллергенов нет».
  allergens: string[] | null;
  portion_grams: number | null;
  kcal_per_portion: number | null;
  protein_per_portion: number | null;
  fat_per_portion: number | null;
  carbs_per_portion: number | null;
  is_available: boolean;
}

export interface MenuItemWithCategory extends MenuItemRow {
  category_name: string | null;
}

export interface BookingRequestRow {
  id: string;
  restaurant_id: string;
  conversation_id: string | null;
  guest_name: string;
  contact: string;
  booking_at: string;
  guests_count: number;
  comment: string | null;
  status: "pending" | "confirmed" | "declined" | "cancelled";
  idempotency_key: string;
  /** Заявка-изменение указывает на исходную бронь; у обычной брони null. */
  replaces_id: string | null;
  manager_notified_at: string | null;
  /** Гость получил сообщение о решении менеджера. null — не получал (сообщение в пути или отправка не удалась). Сбрасывается при каждой смене статуса. */
  guest_notified_at: string | null;
  created_at: string;
}

export interface GuestRequestRow {
  id: string;
  restaurant_id: string;
  conversation_id: string | null;
  kind: "feedback" | "complaint" | "manager_request";
  text: string;
  contact: string | null;
  status: "new" | "in_progress" | "resolved";
  idempotency_key: string;
  manager_notified_at: string | null;
  created_at: string;
}

/** Поля заявки на бронь, которые задаёт сервис; остальное (id, status, даты) ставит БД. */
export type NewBookingRequest =
  & Pick<
    BookingRequestRow,
    "restaurant_id" | "conversation_id" | "guest_name" | "contact" | "booking_at" | "guests_count" | "comment" | "idempotency_key"
  >
  & { replaces_id?: string | null };

export type NewGuestRequest = Pick<
  GuestRequestRow,
  "restaurant_id" | "conversation_id" | "kind" | "text" | "contact" | "idempotency_key"
>;
