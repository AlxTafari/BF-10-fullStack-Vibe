import { describe, expect, it } from "vitest";
import { type ListSpec, type MergeRow, applyRowEvent } from "./realtimeMerge";

interface Row extends MergeRow {
  status: "pending" | "confirmed";
  at: number; // порядок списка
}

const row = (id: string, status: Row["status"], at: number, updated = "2026-10-20T10:00:00Z"): Row => ({
  id,
  status,
  at,
  updated_at: updated,
});

// Список «ожидают», по возрастанию at, не больше 3.
const pendingSpec: ListSpec<Row> = {
  matches: (r) => r.status === "pending",
  compare: (a, b) => a.at - b.at || a.id.localeCompare(b.id),
  limit: 3,
};

describe("INSERT", () => {
  it("подходящая строка встаёт на своё место по порядку", () => {
    const rows = [row("a", "pending", 1), row("c", "pending", 3)];
    const result = applyRowEvent(rows, { type: "INSERT", row: row("b", "pending", 2) }, pendingSpec);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("неподходящая строка игнорируется, список — тот же объект", () => {
    const rows = [row("a", "pending", 1)];
    expect(applyRowEvent(rows, { type: "INSERT", row: row("x", "confirmed", 2) }, pendingSpec)).toBe(rows);
  });

  it("дубль события не размножает строку", () => {
    const rows = [row("a", "pending", 1)];
    const result = applyRowEvent(rows, { type: "INSERT", row: row("a", "pending", 1) }, pendingSpec);
    expect(result).toHaveLength(1);
  });

  it("событие раньше ответа запроса и позже него дают одно и то же", () => {
    const fresh = row("a", "pending", 1);
    const afterEvent = applyRowEvent([], { type: "INSERT", row: fresh }, pendingSpec); // событие, потом ответ
    const afterResponse = applyRowEvent([fresh], { type: "INSERT", row: fresh }, pendingSpec); // ответ, потом событие
    expect(afterEvent).toEqual(afterResponse);
  });

  it("за лимитом: вставка и обрезка, самая поздняя выпадает", () => {
    const rows = [row("a", "pending", 1), row("b", "pending", 2), row("d", "pending", 4)];
    const result = applyRowEvent(rows, { type: "INSERT", row: row("c", "pending", 3) }, pendingSpec);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("строка за пределом лимита в хвост не попадает", () => {
    const rows = [row("a", "pending", 1), row("b", "pending", 2), row("c", "pending", 3)];
    const result = applyRowEvent(rows, { type: "INSERT", row: row("z", "pending", 9) }, pendingSpec);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("UPDATE", () => {
  it("заменяет строку, если событие не старее", () => {
    const rows = [row("a", "pending", 1, "2026-10-20T10:00:00Z")];
    const newer = { ...row("a", "pending", 5, "2026-10-20T10:05:00Z") };
    expect(applyRowEvent(rows, { type: "UPDATE", row: newer }, pendingSpec)[0]).toBe(newer);
  });

  it("устаревшее событие не откатывает свежие данные", () => {
    const rows = [row("a", "pending", 1, "2026-10-20T10:05:00Z")];
    const stale = row("a", "pending", 9, "2026-10-20T10:00:00Z");
    expect(applyRowEvent(rows, { type: "UPDATE", row: stale }, pendingSpec)).toBe(rows);
  });

  it("статус сменился и строка больше не подходит — уходит из списка", () => {
    const rows = [row("a", "pending", 1), row("b", "pending", 2)];
    const result = applyRowEvent(rows, { type: "UPDATE", row: row("a", "confirmed", 1, "2026-10-20T10:01:00Z") }, pendingSpec);
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });

  it("строки нет в списке, но теперь подходит — вставляется", () => {
    const rows = [row("b", "pending", 2)];
    const result = applyRowEvent(rows, { type: "UPDATE", row: row("a", "pending", 1) }, pendingSpec);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("строки нет и не подходит — список не меняется", () => {
    const rows = [row("b", "pending", 2)];
    expect(applyRowEvent(rows, { type: "UPDATE", row: row("a", "confirmed", 1) }, pendingSpec)).toBe(rows);
  });

  it("формат времени +00:00 с микросекундами сравнивается как момент, а не как строка", () => {
    const rows = [row("a", "pending", 1, "2026-10-20T10:00:00.500Z")];
    const sameMoment = row("a", "pending", 2, "2026-10-20T10:00:00.500000+00:00");
    expect(applyRowEvent(rows, { type: "UPDATE", row: sameMoment }, pendingSpec)[0]).toBe(sameMoment);
  });
});

describe("DELETE", () => {
  it("удаляет по id, если строка есть", () => {
    const rows = [row("a", "pending", 1), row("b", "pending", 2)];
    expect(applyRowEvent(rows, { type: "DELETE", id: "a" }, pendingSpec).map((r) => r.id)).toEqual(["b"]);
  });
  it("чужой id (событие чужого ресторана) — список не меняется", () => {
    const rows = [row("a", "pending", 1)];
    expect(applyRowEvent(rows, { type: "DELETE", id: "other" }, pendingSpec)).toBe(rows);
  });
});

it("исходный массив не мутируется", () => {
  const rows = Object.freeze([row("a", "pending", 2)]);
  expect(() => applyRowEvent(rows, { type: "INSERT", row: row("b", "pending", 1) }, pendingSpec)).not.toThrow();
});
