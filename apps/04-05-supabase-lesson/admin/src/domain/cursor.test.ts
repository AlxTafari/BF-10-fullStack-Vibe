import { describe, expect, it } from "vitest";
import { type Page, buildPage, compareDesc, compareTimestamptz, mergeFreshPage, mergePage } from "./cursor";

describe("compareTimestamptz", () => {
  it("одинаковый момент в разной записи равен: Z против +00:00, пробел против T", () => {
    expect(compareTimestamptz("2026-10-18T12:00:00+00:00", "2026-10-18T12:00:00Z")).toBe(0);
    expect(compareTimestamptz("2026-10-18 12:00:00+00", "2026-10-18T12:00:00.000000Z")).toBe(0);
  });

  it("разное число знаков дроби: '.12' это 120000 мкс, а не 12", () => {
    expect(compareTimestamptz("2026-10-18T12:01:00.12+00:00", "2026-10-18T12:01:00.120000+00:00")).toBe(0);
    // Как строки ".5+" и ".12+" сравнились бы побуквенно; как доли секунды 0.5 > 0.12.
    expect(compareTimestamptz("2026-10-18T12:01:00.5+00:00", "2026-10-18T12:01:00.12+00:00")).toBe(1);
    expect(compareTimestamptz("2026-10-18T12:01:00.05+00:00", "2026-10-18T12:01:00.5+00:00")).toBe(-1);
  });

  it("метка без дроби меньше метки с дробью той же секунды", () => {
    expect(compareTimestamptz("2026-10-18T12:02:00+00:00", "2026-10-18T12:02:00.000001+00:00")).toBe(-1);
    expect(compareTimestamptz("2026-10-18T12:02:00.000001+00:00", "2026-10-18T12:02:00+00:00")).toBe(1);
  });

  it("микросекунды различаются (миллисекундный Date их бы склеил)", () => {
    const a = "2026-10-18T12:00:00.123456+00:00";
    const b = "2026-10-18T12:00:00.123457+00:00";
    expect(Date.parse(a)).toBe(Date.parse(b)); // ловушка, ради которой курсор — строка
    expect(compareTimestamptz(a, b)).toBe(-1);
  });

  it("учитывает смещение: 15:03+03:00 это 12:03 UTC", () => {
    expect(compareTimestamptz("2026-10-18T15:03:00.654321+03:00", "2026-10-18T12:03:00.654321+00:00")).toBe(0);
    expect(compareTimestamptz("2026-10-18T15:03:00+03", "2026-10-18T12:03:00+0000")).toBe(0);
    expect(compareTimestamptz("2026-10-18T12:00:00-05:00", "2026-10-18T12:00:00+00:00")).toBe(1);
  });

  it("мусор не превращается в тихий NaN", () => {
    expect(() => compareTimestamptz("вчера", "2026-10-18T12:00:00Z")).toThrow();
    expect(() => compareTimestamptz("2026-13-45T99:00:00Z", "2026-10-18T12:00:00Z")).toThrow();
  });
});

describe("compareDesc", () => {
  const t = "2026-10-18T12:00:00.5+00:00";

  it("новые раньше старых", () => {
    expect(compareDesc({ at: "2026-10-18T12:00:01+00:00", id: "a" }, { at: t, id: "z" })).toBeLessThan(0);
    expect(compareDesc({ at: t, id: "a" }, { at: "2026-10-18T12:00:01+00:00", id: "z" })).toBeGreaterThan(0);
  });

  it("при равной метке решает id по убыванию; полный порядок", () => {
    expect(compareDesc({ at: t, id: "b" }, { at: t, id: "a" })).toBeLessThan(0);
    expect(compareDesc({ at: t, id: "a" }, { at: t, id: "b" })).toBeGreaterThan(0);
    expect(compareDesc({ at: t, id: "a" }, { at: "2026-10-18T12:00:00.500000Z", id: "a" })).toBe(0);
  });
});

interface Row {
  id: string;
  at: string;
}
const keyOf = (r: Row) => ({ at: r.at, id: r.id });
const row = (n: number, at = `2026-10-18T12:00:${String(n).padStart(2, "0")}+00:00`): Row => ({ id: `id-${String(n).padStart(3, "0")}`, at });
/** n строк «новые → старые»: n, n-1, …, 1. */
const newestFirst = (from: number, to: number): Row[] => Array.from({ length: from - to + 1 }, (_, i) => row(from - i));

describe("buildPage (правило pageSize + 1)", () => {
  it("пусто → конец", () => {
    expect(buildPage([], 3, keyOf)).toEqual({ rows: [], nextCursor: null });
  });

  it("меньше страницы → конец, курсора нет", () => {
    const page = buildPage(newestFirst(2, 1), 3, keyOf);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("ровно pageSize строк — это последняя страница (кратно размеру): курсора нет", () => {
    const page = buildPage(newestFirst(3, 1), 3, keyOf);
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("pageSize + 1 → лишняя строка отброшена, курсор у ПОСЛЕДНЕЙ ОСТАВШЕЙСЯ", () => {
    const fetched = newestFirst(4, 1); // 4,3,2,1 при pageSize 3
    const page = buildPage(fetched, 3, keyOf);
    expect(page.rows.map((r) => r.id)).toEqual(["id-004", "id-003", "id-002"]);
    expect(page.nextCursor).toEqual({ at: row(2).at, id: "id-002" });
  });

  it("курсор берёт строку как есть, без прохода через Date (микросекунды целы)", () => {
    const micro = "2026-10-18T12:00:00.123456+00:00";
    const page = buildPage([row(3, "2026-10-18T12:00:03+00:00"), row(2, micro), row(1)], 2, keyOf);
    expect(page.nextCursor?.at).toBe(micro);
  });
});

describe("обход страниц", () => {
  it("постранично с ничьими на границе: каждая строка ровно один раз, в порядке", () => {
    // 12 строк, метки по 5 одинаковые (как в demo-seed): границы страницы (4) попадают внутрь групп.
    const all: Row[] = Array.from({ length: 12 }, (_, i) => ({
      id: `id-${String(i).padStart(3, "0")}`,
      at: `2026-10-18T12:00:${String(Math.floor(i / 5)).padStart(2, "0")}.12+00:00`,
    })).sort((a, b) => compareDesc(keyOf(a), keyOf(b)));

    // «БД»: строки строго после курсора в общем порядке, не больше limit.
    const db = (cursor: { at: string; id: string } | null, limit: number) =>
      all.filter((r) => cursor === null || compareDesc(keyOf(r), cursor) > 0).slice(0, limit);

    const seen: Row[] = [];
    let cursor: { at: string; id: string } | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page: Page<Row> = buildPage(db(cursor, 5), 4, keyOf);
      seen.push(...page.rows);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen.map((r) => r.id)).toEqual(all.map((r) => r.id));
  });
});

describe("mergePage", () => {
  const page = (rows: Row[], next: Row | null): Page<Row> => ({ rows, nextCursor: next ? keyOf(next) : null });

  it("без кэша возвращает страницу", () => {
    const p = page(newestFirst(3, 2), row(2));
    expect(mergePage(undefined, p, keyOf)).toBe(p);
  });

  it("дописывает старую страницу, дубли убирает, порядок общий", () => {
    const first = page(newestFirst(6, 4), row(4));
    const second = page([row(4), ...newestFirst(3, 2)], row(2)); // 4 пересекается
    const merged = mergePage(first, second, keyOf);
    expect(merged.rows.map((r) => r.id)).toEqual(["id-006", "id-005", "id-004", "id-003", "id-002"]);
    expect(merged.nextCursor).toEqual(keyOf(row(2)));
  });

  it("повторный запрос той же страницы курсор не откатывает", () => {
    const deep = page(newestFirst(6, 2), row(2));
    const again = page(newestFirst(6, 4), row(4));
    expect(mergePage(deep, again, keyOf).nextCursor).toEqual(keyOf(row(2)));
  });

  it("конец списка (null) глубже любого курсора", () => {
    const loadedAll = page(newestFirst(3, 1), null);
    const fresh = page(newestFirst(4, 2), row(2));
    expect(mergePage(loadedAll, fresh, keyOf).nextCursor).toBeNull();
  });

  it("свежая копия строки заменяет закэшированную", () => {
    const a: Row = { id: "x", at: "2026-10-18T12:00:01+00:00" };
    const merged = mergePage(page([a], null), page([{ ...a, at: "2026-10-18T12:00:01+00:00" }], null), keyOf);
    expect(merged.rows).toHaveLength(1);
  });
});

describe("mergeFreshPage (после обрыва связи)", () => {
  const page = (rows: Row[], next: Row | null): Page<Row> => ({ rows, nextCursor: next ? keyOf(next) : null });

  it("свежая страница пересекается с кэшем → обычное слияние, ничего не теряется", () => {
    const cached = page(newestFirst(10, 7), row(7));
    const fresh = page(newestFirst(12, 9), row(9)); // 12, 11 новые; 10, 9 уже есть
    const merged = mergeFreshPage(cached, fresh, keyOf);
    expect(merged.rows.map((r) => r.id)).toEqual(["id-012", "id-011", "id-010", "id-009", "id-008", "id-007"]);
  });

  it("не пересекается, а за ней есть ещё → дыра: кэш заменён свежей страницей", () => {
    const cached = page(newestFirst(10, 7), row(7));
    const fresh = page(newestFirst(50, 21), row(21)); // пришло больше страницы
    expect(mergeFreshPage(cached, fresh, keyOf)).toBe(fresh);
  });

  it("не пересекается, но свежая страница — весь диалог (курсора нет) → дыры нет, сливаем", () => {
    const cached = page(newestFirst(3, 2), null);
    const fresh = page(newestFirst(5, 4), null);
    expect(mergeFreshPage(cached, fresh, keyOf).rows.map((r) => r.id)).toEqual(["id-005", "id-004", "id-003", "id-002"]);
  });

  it("кэш пуст → свежая страница", () => {
    const fresh = page(newestFirst(3, 1), null);
    expect(mergeFreshPage(undefined, fresh, keyOf)).toBe(fresh);
    expect(mergeFreshPage({ rows: [], nextCursor: null }, fresh, keyOf)).toBe(fresh);
  });
});
