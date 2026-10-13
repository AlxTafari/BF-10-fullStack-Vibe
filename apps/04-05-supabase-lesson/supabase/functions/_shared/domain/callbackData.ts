// callback_data кнопок разделов с id (Telegram ограничивает её 64 байтами; «префикс:uuid» ≈ 40).
// Кнопки главного меню (menu:*) разбираются отдельно, по константам из content.ts.
export type CallbackKind = "faq" | "category" | "dish";

export interface ParsedCallback {
  kind: CallbackKind;
  id: string;
}

const PREFIX: Record<CallbackKind, string> = { faq: "faq", category: "cat", dish: "dish" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildCallback(kind: CallbackKind, id: string): string {
  return `${PREFIX[kind]}:${id}`;
}

/** null — данные не наши или битые. id проверяем как uuid: callback_data можно подделать, в SQL она не попадёт сырой. */
export function parseCallback(data: string): ParsedCallback | null {
  const [prefix, id, ...rest] = data.split(":");
  if (rest.length > 0 || !id || !UUID.test(id)) return null;
  const kind = (Object.keys(PREFIX) as CallbackKind[]).find((k) => PREFIX[k] === prefix);
  return kind ? { kind, id } : null;
}

// ---------------------------------------------------------------- кнопки пошаговых сценариев (S03)
// Формат flow:<draftId>:<действие>. draftId привязывает кнопку к конкретной заявке: старые сводки
// остаются в чате кликабельными, и без этой привязки их нажатие повлияло бы на новую заявку.
// Действие — «ключ» или «ключ=значение» (d=2026-10-20); двоеточий в нём нет. Влезает в 64 байта: 5 + 36 + 1 + ≤22.
const FLOW_PREFIX = "flow";

export function buildFlowCallback(draftId: string, action: string): string {
  return `${FLOW_PREFIX}:${draftId}:${action}`;
}

export function parseFlowCallback(data: string): { draftId: string; action: string } | null {
  const [prefix, draftId, action, ...rest] = data.split(":");
  if (prefix !== FLOW_PREFIX || rest.length > 0 || !draftId || !action || !UUID.test(draftId)) return null;
  return { draftId, action };
}

export function isFlowCallback(data: string): boolean {
  return data.startsWith(`${FLOW_PREFIX}:`);
}

// ---------------------------------------------------------------- «Мои заявки» (S03)
// bk:<id> — открыть карточку брони, bk:<id>:<действие> — действие над ней (x — спросить об отмене, xy — отменить, ch — изменить).
// id проверяется как uuid, но принадлежность заявки гостю проверяет сервис: callback_data подделывается.
export type BookingAction = "view" | "x" | "xy" | "ch";
const BOOKING_ACTIONS: BookingAction[] = ["view", "x", "xy", "ch"];

export function buildBookingCallback(id: string, action: BookingAction = "view"): string {
  return action === "view" ? `bk:${id}` : `bk:${id}:${action}`;
}

export function parseBookingCallback(data: string): { id: string; action: BookingAction } | null {
  const [prefix, id, action = "view", ...rest] = data.split(":");
  if (prefix !== "bk" || rest.length > 0 || !id || !UUID.test(id)) return null;
  return BOOKING_ACTIONS.includes(action as BookingAction) ? { id, action: action as BookingAction } : null;
}
