import { describe, expect, it } from "vitest";
import { type ConversationEventRow, type ConversationRow, applyConversationEvent } from "./conversations";
import type { Page } from "./cursor";

const row = (n: number, over: Partial<ConversationRow> = {}): ConversationRow => ({
  id: `c-${n}`,
  display_name: `Гость ${n}`,
  channel: "telegram",
  created_at: "2026-10-01T00:00:00+00:00",
  last_message_at: `2026-10-18T12:00:${String(n).padStart(2, "0")}+00:00`,
  last_message_preview: `превью ${n}`,
  last_message_direction: "in",
  manager_last_read_at: `2026-10-18T12:00:${String(n).padStart(2, "0")}+00:00`,
  unread_count: 0,
  ...over,
});
/** Событие по строке: как её присылает Realtime (без unread_count). */
const event = (r: ConversationRow, over: Partial<ConversationEventRow> = {}): ConversationEventRow => {
  const rest: Partial<ConversationRow> = { ...r };
  delete rest.unread_count;
  return { ...(rest as Omit<ConversationRow, "unread_count">), ...over };
};
const list = (rows: ConversationRow[], more = false): Page<ConversationRow> => ({
  rows,
  nextCursor: more ? { at: "x", id: "y" } : null,
});
const ids = (l: Page<ConversationRow>) => l.rows.map((r) => r.id);

describe("applyConversationEvent", () => {
  it("служебный UPDATE (setConversationState бота) — игнор: тот же объект, без перерисовки и без запроса", () => {
    const l = list([row(5), row(4)]);
    const result = applyConversationEvent(l, event(row(5)));
    expect(result.list).toBe(l);
    expect(result.needsRefresh).toBe(false);
  });

  it("то же, если метки записаны иначе (дробь, Z) — это не изменение", () => {
    const l = list([row(5)]);
    const result = applyConversationEvent(l, event(row(5), { last_message_at: "2026-10-18T12:00:05.000000Z", manager_last_read_at: "2026-10-18T12:00:05Z" }));
    expect(result.list).toBe(l);
  });

  it("новое сообщение — диалог всплывает вверх, превью обновлено, число уточняется у сервера", () => {
    const l = list([row(5), row(4), row(3)]);
    const updated = event(row(3), { last_message_at: "2026-10-18T12:01:00+00:00", last_message_preview: "новое", last_message_direction: "in" });
    const result = applyConversationEvent(l, updated);
    expect(ids(result.list)).toEqual(["c-3", "c-5", "c-4"]);
    expect(result.list.rows[0]?.last_message_preview).toBe("новое");
    expect(result.needsRefresh).toBe(true); // текст гостя это или нажатие кнопки — событие не говорит
  });

  it("unread_count не угадывается: остаётся прежним до ответа сервера", () => {
    const l = list([row(5, { unread_count: 2, manager_last_read_at: "2026-10-18T11:00:00+00:00" })]);
    const result = applyConversationEvent(l, event(row(5), { last_message_at: "2026-10-18T12:01:00+00:00", manager_last_read_at: "2026-10-18T11:00:00+00:00" }));
    expect(result.list.rows[0]?.unread_count).toBe(2);
    expect(result.needsRefresh).toBe(true);
  });

  it("прочли в другой вкладке (отметка ≥ последнего сообщения) → unread_count = 0, запрос не нужен", () => {
    const l = list([row(5, { unread_count: 3, manager_last_read_at: null })]);
    const result = applyConversationEvent(l, event(row(5), { manager_last_read_at: "2026-10-18T12:00:05+00:00" }));
    expect(result.list.rows[0]?.unread_count).toBe(0);
    expect(result.needsRefresh).toBe(false);
  });

  it("частичная отметка (прочли не всё) → число знает сервер", () => {
    const l = list([row(5, { unread_count: 3, manager_last_read_at: null })]);
    const result = applyConversationEvent(l, event(row(5), { manager_last_read_at: "2026-10-18T12:00:03+00:00" }));
    expect(result.needsRefresh).toBe(true);
  });

  it("запоздавшее событие не откатывает последнее сообщение", () => {
    const l = list([row(5, { last_message_at: "2026-10-18T12:05:00+00:00", last_message_preview: "свежее" })]);
    const result = applyConversationEvent(l, event(row(5), { last_message_at: "2026-10-18T12:00:05+00:00", last_message_preview: "старое" }));
    expect(result.list.rows[0]?.last_message_preview).toBe("свежее");
    expect(result.list.rows[0]?.last_message_at).toBe("2026-10-18T12:05:00+00:00");
  });

  it("отметка прочтения только растёт: запоздавшее событие с меньшей её не откатывает", () => {
    const l = list([row(5, { manager_last_read_at: "2026-10-18T12:00:05+00:00" })]);
    const result = applyConversationEvent(l, event(row(5), { manager_last_read_at: "2026-10-18T11:00:00+00:00" }));
    expect(result.list).toBe(l);
  });

  it("новый диалог: первое сообщение пришло UPDATE'ом от триггера → входит в список вверх", () => {
    const l = list([row(5)]);
    const fresh = row(9, { manager_last_read_at: null });
    const result = applyConversationEvent(l, event(fresh));
    expect(ids(result.list)).toEqual(["c-9", "c-5"]);
    expect(result.needsRefresh).toBe(true);
  });

  it("диалог без сообщений (INSERT самого диалога) в список не попадает", () => {
    const l = list([row(5)]);
    const result = applyConversationEvent(l, event(row(9), { last_message_at: null }));
    expect(result.list).toBe(l);
    expect(result.needsRefresh).toBe(false);
  });

  it("событие старее загруженной части (список ещё не дочитан) → игнор, придёт со страницей", () => {
    const l = list([row(9), row(8)], true);
    const result = applyConversationEvent(l, event(row(1)));
    expect(result.list).toBe(l);
  });

  it("список загружен целиком → диалог любого возраста входит на своё место", () => {
    const l = list([row(9), row(8)], false);
    expect(ids(applyConversationEvent(l, event(row(1))).list)).toEqual(["c-9", "c-8", "c-1"]);
  });
});
