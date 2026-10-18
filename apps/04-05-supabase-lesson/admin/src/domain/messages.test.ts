import { describe, expect, it } from "vitest";
import type { Page } from "./cursor";
import { type Message, applyMessageEvent, buttonData, classifyMessage, groupByDay, shouldMarkRead } from "./messages";

const CONV = "conv-1";
const msg = (n: number, over: Partial<Message> = {}): Message => ({
  id: `m-${String(n).padStart(3, "0")}`,
  conversation_id: CONV,
  direction: "in",
  kind: "text",
  text: `текст ${n}`,
  created_at: `2026-10-18T12:00:${String(n).padStart(2, "0")}+00:00`,
  ...over,
});
/** Кэш «новые → старые» из сообщений с номерами from…to (from ≥ to). */
const cache = (from: number, to: number, nextCursor: Page<Message>["nextCursor"] = { at: "x", id: "y" }): Page<Message> => ({
  rows: Array.from({ length: from - to + 1 }, (_, i) => msg(from - i)),
  nextCursor,
});
const ids = (p: Page<Message>) => p.rows.map((r) => r.id);

describe("applyMessageEvent", () => {
  it("новее самого нового — в начало (обычный случай)", () => {
    const c = cache(10, 8);
    expect(ids(applyMessageEvent(c, msg(11), CONV))).toEqual(["m-011", "m-010", "m-009", "m-008"]);
  });

  it("дубль события — тот же объект кэша (перерисовки нет)", () => {
    const c = cache(10, 8);
    expect(applyMessageEvent(c, msg(9), CONV)).toBe(c);
  });

  it("чужой диалог (гонка при переключении) — игнор", () => {
    const c = cache(10, 8);
    expect(applyMessageEvent(c, msg(11, { conversation_id: "other" }), CONV)).toBe(c);
  });

  it("внутри диапазона — на своё место, не в голову (приехало не по порядку)", () => {
    const c: Page<Message> = { rows: [msg(10), msg(8), msg(6)], nextCursor: { at: "x", id: "y" } };
    expect(ids(applyMessageEvent(c, msg(9), CONV))).toEqual(["m-010", "m-009", "m-008", "m-006"]);
    expect(ids(applyMessageEvent(c, msg(7), CONV))).toEqual(["m-010", "m-008", "m-007", "m-006"]);
  });

  it("старее самого старого загруженного — игнор (придёт со страницей при прокрутке)", () => {
    const c = cache(10, 8);
    expect(applyMessageEvent(c, msg(3), CONV)).toBe(c);
  });

  it("старее самого старого, но загружен весь диалог (курсора нет) — вставляется: прокрутки не будет", () => {
    const c = cache(10, 8, null);
    expect(ids(applyMessageEvent(c, msg(3), CONV))).toEqual(["m-010", "m-009", "m-008", "m-003"]);
  });

  it("одинаковая метка: порядок решает id, дубля нет", () => {
    const same = "2026-10-18T12:00:09+00:00";
    const a = msg(9, { id: "a", created_at: same });
    const z = msg(9, { id: "z", created_at: same });
    const c: Page<Message> = { rows: [z], nextCursor: null };
    expect(ids(applyMessageEvent(c, a, CONV))).toEqual(["z", "a"]); // id по убыванию
    expect(ids(applyMessageEvent({ rows: [a], nextCursor: null }, z, CONV))).toEqual(["z", "a"]);
  });

  it("пустой кэш — сообщение становится первым", () => {
    expect(ids(applyMessageEvent({ rows: [], nextCursor: null }, msg(1), CONV))).toEqual(["m-001"]);
  });

  it("метки с разной длиной дроби упорядочены как числа", () => {
    const c: Page<Message> = {
      rows: [msg(1, { id: "a", created_at: "2026-10-18T12:00:00.5+00:00" }), msg(0, { id: "b", created_at: "2026-10-18T12:00:00.05+00:00" })],
      nextCursor: null,
    };
    const mid = msg(5, { id: "m", created_at: "2026-10-18T12:00:00.12+00:00" });
    expect(ids(applyMessageEvent(c, mid, CONV))).toEqual(["a", "m", "b"]);
  });
});

describe("classifyMessage / buttonData", () => {
  it("классификация по kind, а не по префиксу текста", () => {
    expect(classifyMessage(msg(1, { kind: "button", text: "[кнопка] menu:booking" }))).toBe("button");
    expect(classifyMessage(msg(2, { kind: "text", text: "[кнопка] это написал гость руками" }))).toBe("bubble");
  });

  it("поиск — отдельный класс, и для гостя, и для бота", () => {
    expect(classifyMessage(msg(3, { kind: "search", text: "борщ" }))).toBe("search");
    expect(classifyMessage(msg(4, { kind: "search", direction: "out" }))).toBe("search");
  });

  it("buttonData отдаёт сырой callback_data", () => {
    expect(buttonData(msg(1, { kind: "button", text: "[кнопка] flow:3f2a:date:2026-10-20" }))).toBe("flow:3f2a:date:2026-10-20");
    expect(buttonData(msg(2, { text: "обычный" }))).toBe("обычный");
  });
});

describe("groupByDay", () => {
  const ATHENS = "Europe/Athens";
  const at = (created_at: string, id: string): Message => ({ ...msg(0), id, created_at });

  it("кэш «новые → старые» выводится хронологически, с разделителями дней", () => {
    const rows = [at("2026-10-19T09:00:00+00:00", "c"), at("2026-10-18T09:00:00+00:00", "b"), at("2026-10-18T08:00:00+00:00", "a")];
    const groups = groupByDay(rows, ATHENS);
    expect(groups.map((g) => g.day)).toEqual(["2026-10-18", "2026-10-19"]);
    expect(groups[0]?.messages.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("полночь по поясу ресторана: 23:50 и 00:10 — разные группы", () => {
    const rows = [at("2026-10-18T21:10:00+00:00", "late"), at("2026-10-18T20:50:00+00:00", "early")];
    expect(groupByDay(rows, ATHENS).map((g) => g.day)).toEqual(["2026-10-18", "2026-10-19"]);
    expect(groupByDay(rows, "UTC").map((g) => g.day)).toEqual(["2026-10-18"]);
  });

  it("день перевода часов (25 часов) — одна группа", () => {
    const rows = [at("2026-10-25T21:30:00+00:00", "d"), at("2026-10-25T01:30:00+00:00", "c"), at("2026-10-25T00:30:00+00:00", "b")];
    expect(groupByDay(rows, ATHENS)).toHaveLength(1);
  });

  it("пусто → пусто", () => {
    expect(groupByDay([], ATHENS)).toEqual([]);
  });
});

describe("shouldMarkRead", () => {
  const view = { isOpen: true, atBottom: true, visible: true };
  const rows = [msg(9, { direction: "out" }), msg(8, { kind: "button", text: "[кнопка] x" }), msg(7), msg(5)];

  it("всё условия выполнены → отметка до последнего ВХОДЯЩЕГО ТЕКСТОВОГО (не кнопка, не бот)", () => {
    expect(shouldMarkRead(view, rows, null)).toBe(msg(7).created_at);
  });

  it("не внизу / вкладка скрыта / диалог не открыт → null: прочитанным не становится", () => {
    expect(shouldMarkRead({ ...view, atBottom: false }, rows, null)).toBeNull();
    expect(shouldMarkRead({ ...view, visible: false }, rows, null)).toBeNull();
    expect(shouldMarkRead({ ...view, isOpen: false }, rows, null)).toBeNull();
  });

  it("уже отмечено до этого момента (в т.ч. при другой длине дроби) → null, лишнего вызова нет", () => {
    expect(shouldMarkRead(view, rows, "2026-10-18T12:00:07.000000+00:00")).toBeNull();
    expect(shouldMarkRead(view, rows, "2026-10-18T12:00:08+00:00")).toBeNull();
  });

  it("отметка старее входящего → вызов", () => {
    expect(shouldMarkRead(view, rows, "2026-10-18T12:00:06+00:00")).toBe(msg(7).created_at);
  });

  it("нет входящих текстовых → null", () => {
    expect(shouldMarkRead(view, [msg(1, { direction: "out" })], null)).toBeNull();
    expect(shouldMarkRead(view, [], null)).toBeNull();
  });
});
