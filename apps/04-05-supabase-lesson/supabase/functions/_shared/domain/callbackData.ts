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
