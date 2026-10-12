export type MessageDirection = "in" | "out";

export interface RestaurantRow {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  working_hours: string | null;
}

export interface ConversationRow {
  id: string;
  restaurant_id: string;
  channel: string;
  external_user_id: number;
  chat_id: number;
  display_name: string | null;
  // Состояние пошагового сценария; в S01 не используется (машина состояний — S03).
  state: Record<string, unknown>;
  last_message_at: string | null;
}
