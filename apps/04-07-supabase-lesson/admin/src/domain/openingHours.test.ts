import { describe, expect, it } from "vitest";
import { applyToAll, DAY_KEYS, describeHours, fromDb, toDb, validateHours, validateWindow } from "./openingHours";

describe("validateWindow", () => {
  it("нормальное окно и 24:00 как закрытие", () => {
    expect(validateWindow({ open: "13:00", close: "22:30" })).toBeNull();
    expect(validateWindow({ open: "13:00", close: "24:00" })).toBeNull();
  });

  it("close <= open нельзя, в том числе через полночь", () => {
    expect(validateWindow({ open: "18:00", close: "17:00" })).toMatch(/позже/);
    expect(validateWindow({ open: "18:00", close: "18:00" })).toMatch(/позже/);
    expect(validateWindow({ open: "18:00", close: "02:00" })).toMatch(/позже/);
  });

  it("мусор в формате времени", () => {
    expect(validateWindow({ open: "9:00", close: "22:00" })).not.toBeNull();
    expect(validateWindow({ open: "25:00", close: "26:00" })).not.toBeNull();
    expect(validateWindow({ open: "09:60", close: "22:00" })).not.toBeNull();
    expect(validateWindow({ open: "", close: "22:00" })).not.toBeNull();
    // 24:00 допустимо только как закрытие
    expect(validateWindow({ open: "24:00", close: "24:00" })).not.toBeNull();
  });
});

describe("fromDb / toDb", () => {
  it("null → без ограничений, и обратно", () => {
    const state = fromDb(null);
    expect(state.unrestricted).toBe(true);
    expect(toDb(state)).toBeNull();
  });

  it("{} → закрыто всегда, не null", () => {
    const state = fromDb({});
    expect(state.unrestricted).toBe(false);
    expect(DAY_KEYS.every((k) => !state.days[k].enabled)).toBe(true);
    expect(toDb(state)).toEqual({});
  });

  it("круговой обход сохраняет данные; выходной = нет ключа", () => {
    const db = { "1": { open: "13:00", close: "24:00" }, "5": { open: "12:00", close: "23:00" } };
    const state = fromDb(db);
    expect(state.days["1"].enabled).toBe(true);
    expect(state.days["7"].enabled).toBe(false);
    expect(toDb(state)).toEqual(db);
  });

  it("выключить день → ключа нет в результате", () => {
    const state = fromDb({ "7": { open: "10:00", close: "20:00" } });
    state.days["7"].enabled = false;
    expect(toDb(state)).toEqual({});
  });

  it("мусор из jsonb не ломает: чужие ключи и битые окна игнорируются", () => {
    const state = fromDb({ "0": { open: "10:00", close: "20:00" }, "8": {}, "2": { open: 1 }, "3": null });
    expect(DAY_KEYS.every((k) => !state.days[k].enabled)).toBe(true);
    expect(fromDb("строка").unrestricted).toBe(false);
    expect(fromDb([1, 2]).unrestricted).toBe(false);
  });
});

describe("validateHours", () => {
  it("проверяет только включённые дни", () => {
    const state = fromDb({});
    state.days["2"] = { enabled: false, open: "18:00", close: "17:00" };
    expect(validateHours(state)).toEqual({});
    state.days["2"].enabled = true;
    expect(Object.keys(validateHours(state))).toEqual(["2"]);
  });

  it("при «без ограничений» дни не проверяются", () => {
    const state = fromDb(null);
    state.days["1"] = { enabled: true, open: "18:00", close: "17:00" };
    expect(validateHours(state)).toEqual({});
  });
});

describe("applyToAll", () => {
  it("копирует окно и флаг на все дни", () => {
    const state = fromDb({ "3": { open: "11:00", close: "23:00" } });
    const next = applyToAll(state, "3");
    for (const key of DAY_KEYS) expect(next.days[key]).toEqual({ enabled: true, open: "11:00", close: "23:00" });
    // исходное состояние не мутируется
    expect(state.days["1"].enabled).toBe(false);
  });
});

describe("describeHours", () => {
  it("словами различает null и {}", () => {
    expect(describeHours(fromDb(null))).toMatch(/не ограничена/);
    expect(describeHours(fromDb({}))).toMatch(/закрыт всегда/);
    expect(describeHours(fromDb({ "1": { open: "10:00", close: "20:00" } }))).toMatch(/только в отмеченные/);
  });
});
