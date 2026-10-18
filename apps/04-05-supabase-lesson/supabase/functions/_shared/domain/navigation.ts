// Политика «что делать с навигационным сообщением бота» (S06d). Чистая логика: ни Telegram, ни БД.
// Принцип — тонкая чистка против дублей, а не «чистый чат»: бот помнит только ПОСЛЕДНЕЕ навигационное сообщение.

/** Окно, в котором повтор того же экрана подряд считается дублем. Константа здесь, не в SQL и не в обработчиках. */
export const DUPLICATE_WINDOW_SECONDS = 120;

/** Навигационный экран = то, что проходит через replyNav. FAQ, поиск, сценарии и заявки сюда не входят. */
export type NavScreen = "menu" | "info" | "cats" | `cat:${string}` | `dish:${string}` | `flow:${string}`;

/** flow — пошаговый сценарий (бронь, обращение): один черновик = один экран `flow:<draftId>`, шаги перерисовывают сообщение. */
export type NavSection = "menu" | "info" | "dishes" | "flow";

/** Что лежит в conversations.last_nav про последнее навигационное сообщение. */
export interface LastNav {
  screen: string;
  messageId: number;
  /** ISO-метка отправки (now() БД). */
  at: string;
}

export function sectionOf(screen: string): NavSection | null {
  if (screen === "menu") return "menu";
  if (screen === "info") return "info";
  if (screen.startsWith("flow:")) return "flow";
  if (screen === "cats" || screen.startsWith("cat:") || screen.startsWith("dish:")) return "dishes";
  return null;
}

export type NavDecision =
  | { type: "edit"; messageId: number }
  | { type: "send"; deleteId: number | null };

interface DecideNavInput {
  screen: NavScreen;
  /** message_id сообщения, под которым нажали кнопку; null — текстовый апдейт. */
  callbackMessageId: number | null;
  last: LastNav | null;
  now: Date;
  /** Итог сценария: показать новым сообщением внизу (под уведомлениями), а сводку удалить, а не править её выше. */
  redraw?: boolean;
}

export function decideNav({ screen, callbackMessageId, last, now, redraw = false }: DecideNavInput): NavDecision {
  const section = sectionOf(screen);

  // Правка «Меню блюд»: нажали кнопку в самом последнем сообщении, и оно из того же раздела.
  if (
    last && section === "dishes" && callbackMessageId !== null && callbackMessageId === last.messageId &&
    sectionOf(last.screen) === section
  ) {
    return { type: "edit", messageId: last.messageId };
  }

  if (last && section === "flow" && last.screen === screen && redraw) {
    return { type: "send", deleteId: last.messageId };
  }

  // Сценарий, кнопка: нажата на последнем сообщении этого же черновика → правим его на месте.
  if (last && section === "flow" && last.screen === screen && callbackMessageId !== null && callbackMessageId === last.messageId) {
    return { type: "edit", messageId: last.messageId };
  }

  // Сценарий, текстовый ответ (имя, контакт, комментарий): гость написал ниже, и правка сообщения выше осталась бы
  // за его текстом (а повтор той же ошибки Telegram отверг бы как «not modified»). Поэтому рисуем шаг заново внизу,
  // а прежнее сообщение этого черновика удаляем.
  if (last && section === "flow" && last.screen === screen && callbackMessageId === null) {
    return { type: "send", deleteId: last.messageId };
  }

  // Антидубль: удаляем предыдущее, только если это ТОТ ЖЕ экран и окно ещё не вышло. Строгое «<»: ровно 120 с — уже не дубль.
  // Сообщение, под которым нажали кнопку, при send не трогаем — удаляется только «последнее» того же экрана.
  // Сценарий сюда не входит: у него экран один на все шаги, одинаковое имя ещё не значит одинаковое содержимое.
  if (last && last.screen === screen && section !== "flow") {
    const ageSeconds = (now.getTime() - Date.parse(last.at)) / 1000;
    if (ageSeconds >= 0 && ageSeconds < DUPLICATE_WINDOW_SECONDS) return { type: "send", deleteId: last.messageId };
  }
  return { type: "send", deleteId: null };
}

/**
 * Разбор last_nav из БД (jsonb приходит как unknown). Нет экрана или message_id — «последнего сообщения нет»:
 * так бывает, когда в last_nav пока лежит только faq_answer_id.
 */
export function parseLastNav(raw: unknown): LastNav | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { screen, message_id, at } = raw as Record<string, unknown>;
  if (typeof screen !== "string" || typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
  if (typeof message_id !== "number" || !Number.isSafeInteger(message_id)) return null;
  return { screen, messageId: message_id, at };
}

/** message_id последнего ответа FAQ с клавиатурой; null — такого нет. */
export function parseFaqAnswerId(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const id = (raw as Record<string, unknown>).faq_answer_id;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}
