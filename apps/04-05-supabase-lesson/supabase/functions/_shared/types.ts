import type { OpeningHours } from "./domain/bookingRules.ts";

export type MessageDirection = "in" | "out";
/**
 * text — обычное сообщение, button — нажатие inline-кнопки (текст остаётся «[кнопка] …»),
 * search — поиск блюда свободным текстом и ответ бота на него (S06c: живёт 7 дней, не двигает превью).
 */
export type MessageKind = "text" | "button" | "search";

/**
 * Расход хода агента (S09): сумма по всем вызовам модели за ход. Храним токены, а не деньги — цены меняются
 * (у части моделей дорожают с 2027-01-01), стоимость считается при показе по таблице цен.
 */
export interface AiTurnUsage {
  /** Сколько раз за ход вызывалась модель (раунды tools + финальный ответ). */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** «Размышления» модели: оплачиваются как выход, считаются отдельно. */
  thoughtTokens: number;
  /** Длительность хода, мс — от первого вызова модели до ответа или сбоя. */
  ms: number;
}

/**
 * Служебная пометка сообщения (messages.meta, S09). null — обычное сообщение.
 * - ai — ответ агента: модель, какие tools он вызвал за ход и расход (видно в админке, по ним же суточный
 *   лимит и статистика);
 * - aiFallback — агент не ответил (ошибка, таймаут, лимит), гость получил запасной ответ с кнопками.
 *   Ходом агента не считается: в лимит не идёт. Расход есть, если модель успела ответить хоть раз
 *   (например, таймаут на третьем раунде) — эти токены тоже оплачены.
 * - manager — реплику написал менеджер из админки (S06b); managerId — auth.users.id без внешнего ключа:
 *   журнал не должен ломаться при удалении пользователя.
 */
export type MessageMeta =
  | ({ ai: true; model: string; tools: string[] } & AiTurnUsage)
  | ({ aiFallback: "error" | "timeout" | "quota" | "limit"; model?: string } & Partial<AiTurnUsage>)
  | { manager: true; managerId: string }
  | { voice: VoiceMeta };

/**
 * Голосовое гостя (S09, сессия 4). Аудио не храним: fileId — ключ, по которому файл скачивается у Telegram
 * (прослушивание в админке, распознавание по кнопке). Расход распознавания — те же поля, что у хода агента:
 * статистика суммирует их отдельной группой. calls = 0 / нет полей — модель не вызывалась.
 */
export type VoiceMeta = {
  fileId: string;
  duration: number;
  mimeType?: string;
  fileSize?: number;
  /** Кто распознал: auto — бот для агента, manager — кнопка в админке. Нет — текст не получен. */
  transcribedBy?: "auto" | "manager";
  /**
   * Распознать не вышло: unclear — речи не разобрать (вызов оплачен), download — файл не скачан, остальное —
   * класс сбоя модели (как у aiFallback). При успехе поля нет.
   */
  transcribeError?: VoiceTranscribeError;
  model?: string;
} & Partial<AiTurnUsage>;

export type VoiceTranscribeError = "unclear" | "download" | "too_big" | "quota" | "timeout" | "unavailable" | "bad_response";

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
  // Последнее навигационное сообщение бота (S06d): { screen, message_id, at, faq_answer_id? }. Разбирается через parseLastNav.
  last_nav: unknown | null;
  // Ручной режим (S06b): пока метка в будущем, менеджер в диалоге и бот не отвечает на свободный текст.
  // Пишут только RPC менеджера; проверка — domain/managerChat.ts (isHandoffActive).
  handoff_until: string | null;
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
  // Коды справочника ЕС (domain/allergens.ts), гарантирует check в БД. null = не указано, [] = указано «аллергенов нет».
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
