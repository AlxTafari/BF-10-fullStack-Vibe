import { describe, expect, it } from "vitest";
import { applyOrder, nextSortOrder, reorder, sortByOrder } from "./reorder";

const item = (id: string, sort_order: number, created_at = "2026-01-01T00:00:00Z") => ({ id, sort_order, created_at });
const abc = [item("a", 0), item("b", 1), item("c", 2), item("d", 3)];

describe("reorder", () => {
  it("вниз: a → на место c; меняются только сдвинутые", () => {
    // порядок становится b, c, a, d
    expect(reorder(abc, 0, 2)).toEqual([
      { id: "b", sort_order: 0 },
      { id: "c", sort_order: 1 },
      { id: "a", sort_order: 2 },
    ]);
  });

  it("вверх: d → в начало", () => {
    expect(reorder(abc, 3, 0)).toEqual([
      { id: "d", sort_order: 0 },
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
      { id: "c", sort_order: 3 },
    ]);
  });

  it("соседние: меняются ровно две записи", () => {
    expect(reorder(abc, 1, 2)).toEqual([
      { id: "c", sort_order: 1 },
      { id: "b", sort_order: 2 },
    ]);
  });

  it("то же место и неверные индексы → ничего", () => {
    expect(reorder(abc, 2, 2)).toEqual([]);
    expect(reorder(abc, -1, 2)).toEqual([]);
    expect(reorder(abc, 0, 4)).toEqual([]);
    expect(reorder(abc, 0.5, 1)).toEqual([]);
    expect(reorder([], 0, 0)).toEqual([]);
  });

  it("нормализует «дыры» и равные значения", () => {
    const messy = [item("a", 10), item("b", 10), item("c", 50)];
    // переносим c в начало: c0, a1, b2 — перезаписаны все трое
    expect(reorder(messy, 2, 0)).toEqual([
      { id: "c", sort_order: 0 },
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
    ]);
  });

  it("результат не мутирует вход", () => {
    const copy = structuredClone(abc);
    reorder(abc, 0, 3);
    expect(abc).toEqual(copy);
  });
});

describe("sortByOrder", () => {
  it("равные sort_order → по created_at, затем по id", () => {
    const list = [item("z", 1, "2026-01-02T00:00:00Z"), item("y", 1, "2026-01-01T00:00:00Z"), item("x", 1, "2026-01-01T00:00:00Z")];
    expect(sortByOrder(list).map((i) => i.id)).toEqual(["x", "y", "z"]);
  });
});

describe("applyOrder", () => {
  it("применяет изменения и пересортировывает", () => {
    const changes = reorder(abc, 0, 2);
    expect(applyOrder(abc, changes).map((i) => i.id)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("nextSortOrder", () => {
  it("max + 1; для пустого списка 0", () => {
    expect(nextSortOrder(abc)).toBe(4);
    expect(nextSortOrder([item("a", 7)])).toBe(8);
    expect(nextSortOrder([])).toBe(0);
  });
});
