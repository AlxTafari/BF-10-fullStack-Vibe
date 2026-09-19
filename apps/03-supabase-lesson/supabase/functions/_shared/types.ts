export type ReactionType = "like" | "funny" | "shock" | "doubt";
export type Scene = "village" | "campfire";

export interface Camp {
  id: string;
  name: string;
}

export interface UserRow {
  id: string;
  tg_id: number;
  name: string | null;
  camp_id: string | null;
  role: string;
  scene: Scene;
  last_message_at: string | null;
}

export interface NewsRow {
  id: string;
  author_id: string | null;
  posted_by: string | null;
  camp_id: string | null;
  text: string;
  created_at: string;
}

export interface ReactionRow {
  user_id: string;
  news_id: string;
  reaction_type: ReactionType;
  created_at: string;
}

export interface MessageRow {
  id: string;
  user_id: string;
  direction: "in" | "out";
  text: string;
  created_at: string;
}
