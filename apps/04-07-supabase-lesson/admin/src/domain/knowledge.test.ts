import { describe, expect, it } from "vitest";
import {
  BODY_MAX,
  EMPTY_DOCUMENT,
  EMPTY_TOTALS,
  type IndexFields,
  TITLE_MAX,
  addPortion,
  documentSchema,
  documentTypeLabel,
  indexErrorText,
  indexOutcomeText,
  indexState,
  knowledgeSearchSchema,
  mapLimit,
  moveItem,
  needsIndex,
  saveErrorText,
  toSaveArgs,
  toggleDish,
} from "./knowledge";

describe("documentSchema", () => {
  const ok = { title: "История", body: "Текст", type: "history", is_published: true, dishIds: [] };

  it("валидный документ проходит; пробелы обрезаются", () => {
    const r = documentSchema.safeParse({ ...ok, title: "  История  ", body: "\n Текст \n" });
    expect(r.success && r.data.title).toBe("История");
    expect(r.success && r.data.body).toBe("Текст");
  });

  it("пустые и из пробелов — ошибка", () => {
    expect(documentSchema.safeParse({ ...ok, title: "  " }).success).toBe(false);
    expect(documentSchema.safeParse({ ...ok, body: "" }).success).toBe(false);
  });

  it("пределы как в БД: 200 / 20 000", () => {
    expect(documentSchema.safeParse({ ...ok, title: "н".repeat(TITLE_MAX) }).success).toBe(true);
    expect(documentSchema.safeParse({ ...ok, title: "н".repeat(TITLE_MAX + 1) }).success).toBe(false);
    expect(documentSchema.safeParse({ ...ok, body: "т".repeat(BODY_MAX) }).success).toBe(true);
    expect(documentSchema.safeParse({ ...ok, body: "т".repeat(BODY_MAX + 1) }).success).toBe(false);
  });

  it("незнакомый тип — ошибка", () => {
    expect(documentSchema.safeParse({ ...ok, type: "karaoke" }).success).toBe(false);
  });

  it("новый документ — черновик и не валиден пустым", () => {
    expect(EMPTY_DOCUMENT.is_published).toBe(false);
    expect(documentSchema.safeParse(EMPTY_DOCUMENT).success).toBe(false);
  });
});

describe("toSaveArgs", () => {
  const values = { title: "Т", body: "Б", is_published: true, dishIds: ["a", "b"] };

  it("подборка отправляет блюда в выбранном порядке", () => {
    expect(toSaveArgs(null, { ...values, type: "collection" }).p_dish_ids).toEqual(["a", "b"]);
  });

  it("не подборка — связи пустые, даже если в форме остались после смены типа", () => {
    const args = toSaveArgs("id-1", { ...values, type: "history" });
    expect(args.p_dish_ids).toEqual([]);
    expect(args.p_id).toBe("id-1");
  });
});

describe("documentTypeLabel", () => {
  it("фильтр в адресе: мусор — без фильтра", () => {
    expect(knowledgeSearchSchema.parse({ type: "event" })).toEqual({ type: "event" });
    expect(knowledgeSearchSchema.parse({ type: "karaoke" })).toEqual({ type: undefined });
    expect(knowledgeSearchSchema.parse({})).toEqual({});
  });

  it("код → подпись, незнакомый как есть", () => {
    expect(documentTypeLabel("collection")).toBe("Подборка блюд");
    expect(documentTypeLabel("new_type")).toBe("new_type");
  });
});

describe("indexState / needsIndex", () => {
  const ready: IndexFields = {
    is_published: true,
    index_status: "ready",
    index_error: null,
    index_revision: 3,
    indexed_revision: 3,
  };

  it("готово только при совпадающей версии", () => {
    expect(indexState(ready)).toBe("ready");
    expect(indexState({ ...ready, indexed_revision: 2 })).toBe("pending");
    expect(needsIndex(ready)).toBe(false);
  });

  it("неопубликованный — «Не опубликован» при любом статусе, индексировать не надо", () => {
    const row = { ...ready, is_published: false, index_status: "error", index_error: "x" };
    expect(indexState(row)).toBe("unpublished");
    expect(needsIndex(row)).toBe(false);
  });

  it("pending и error требуют индексации («Повторить»)", () => {
    const pending = { ...ready, index_status: "pending", indexed_revision: null };
    const error = { ...ready, index_status: "error", index_error: "сбой", index_revision: 4 };
    expect(indexState(pending)).toBe("pending");
    expect(indexState(error)).toBe("error");
    expect(needsIndex(pending)).toBe(true);
    expect(needsIndex(error)).toBe(true);
  });
});

describe("addPortion", () => {
  it("суммирует счётчики и ошибки порций", () => {
    const p1 = { ready: 9, error: 1, skipped: 0, superseded: 0, errors: [{ source: "document" as const, id: "d1", message: "m" }], nextCursor: { source: "document" as const, id: "d10" } };
    const p2 = { ready: 3, error: 0, skipped: 1, superseded: 1, errors: [], nextCursor: null };
    const total = addPortion(addPortion(EMPTY_TOTALS, p1), p2);
    expect(total).toEqual({ ready: 12, error: 1, skipped: 1, superseded: 1, errors: p1.errors, portions: 2 });
    expect(EMPTY_TOTALS.portions).toBe(0);
  });
});

describe("тексты ошибок", () => {
  it("итог индексации источника", () => {
    expect(indexOutcomeText({ status: "ready" })).toBeNull();
    expect(indexOutcomeText({ status: "error", message: "сократите текст" })).toContain("сократите текст");
    expect(indexOutcomeText({ status: "superseded" })).toBeTruthy();
  });

  it("коды Edge Function; неизвестный — общий текст", () => {
    expect(indexErrorText("ai_unavailable")).toContain("Gemini");
    expect(indexErrorText("internal")).toBe(indexErrorText(undefined));
  });

  it("коды RPC сохранения; неизвестный — null", () => {
    expect(saveErrorText("invalid_dishes")).toContain("удалённое");
    expect(saveErrorText("violates check constraint")).toBeNull();
    expect(saveErrorText(undefined)).toBeNull();
  });
});

describe("выбор блюд подборки", () => {
  it("toggleDish: новое в конец, повторное — убирает", () => {
    expect(toggleDish(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleDish(["a", "b"], "a")).toEqual(["b"]);
  });

  it("moveItem не меняет исходный массив", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("mapLimit", () => {
  it("не больше limit одновременно, ошибка одного не мешает остальным", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (n === 3) throw new Error("сбой");
      return n * 10;
    });
    expect(peak).toBe(2);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected", "fulfilled", "fulfilled"]);
  });

  it("shouldContinue = false — новые элементы не начинаются", async () => {
    let started = 0;
    let go = true;
    await mapLimit([1, 2, 3, 4], 1, async () => {
      started++;
      go = false;
    }, () => go);
    expect(started).toBe(1);
  });
});
