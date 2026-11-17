import { describe, expect, it } from "vitest";
import { type RestaurantRecord, restaurantSchema, toFormValues, toRestaurantUpdate } from "./restaurantSchema";

const record: RestaurantRecord = {
  name: "Тратто",
  description: null,
  address: "ул. Ленина, 1",
  phone: null,
  email: null,
  timezone: "Europe/Moscow",
  currency: "EUR",
  working_hours: null,
  opening_hours: { "1": { open: "13:00", close: "24:00" } },
  manager_chat_id: null,
};

const valid = () => toFormValues(record);

describe("toFormValues / toRestaurantUpdate", () => {
  it("круговой обход: null ↔ пустая строка, данные не теряются", () => {
    expect(toRestaurantUpdate(valid())).toEqual({
      name: "Тратто",
      description: null,
      address: "ул. Ленина, 1",
      phone: null,
      email: null,
      timezone: "Europe/Moscow",
      currency: "EUR",
      working_hours: null,
      opening_hours: { "1": { open: "13:00", close: "24:00" } },
      manager_chat_id: null,
    });
  });

  it("пробелы обрезаются, пустое после trim → null", () => {
    const v = { ...valid(), name: "  Кафе  ", description: "   ", phone: " +7 900 " };
    const u = toRestaurantUpdate(v);
    expect(u.name).toBe("Кафе");
    expect(u.description).toBeNull();
    expect(u.phone).toBe("+7 900");
  });

  it("opening_hours: null и {} различаются", () => {
    const unrestricted = toFormValues({ ...record, opening_hours: null });
    expect(toRestaurantUpdate(unrestricted).opening_hours).toBeNull();
    const closed = toFormValues({ ...record, opening_hours: {} });
    expect(toRestaurantUpdate(closed).opening_hours).toEqual({});
  });
});

describe("manager_chat_id", () => {
  it("число и отрицательное число (группа) проходят, пусто → null", () => {
    expect(toRestaurantUpdate({ ...valid(), manager_chat_id: "123456789" }).manager_chat_id).toBe(123456789);
    expect(toRestaurantUpdate({ ...valid(), manager_chat_id: "-1001234567890" }).manager_chat_id).toBe(-1001234567890);
    expect(toRestaurantUpdate({ ...valid(), manager_chat_id: "" }).manager_chat_id).toBeNull();
  });

  it("не число / дробь / ноль / слишком большое — ошибка", () => {
    for (const bad of ["abc", "12.5", "1e3", "0", "-0", "99999999999999999999"]) {
      expect(restaurantSchema.safeParse({ ...valid(), manager_chat_id: bad }).success, bad).toBe(false);
    }
  });
});

describe("restaurantSchema", () => {
  it("валидные данные проходят", () => {
    expect(restaurantSchema.safeParse(valid()).success).toBe(true);
  });

  it("название обязательно", () => {
    expect(restaurantSchema.safeParse({ ...valid(), name: "   " }).success).toBe(false);
    expect(restaurantSchema.safeParse({ ...valid(), name: "x".repeat(121) }).success).toBe(false);
  });

  it("email: пусто можно, заданный — по формату", () => {
    expect(restaurantSchema.safeParse({ ...valid(), email: "" }).success).toBe(true);
    expect(restaurantSchema.safeParse({ ...valid(), email: "a@b.co" }).success).toBe(true);
    expect(restaurantSchema.safeParse({ ...valid(), email: "не-почта" }).success).toBe(false);
  });

  it("часовой пояс: известный проходит, мусор — нет", () => {
    expect(restaurantSchema.safeParse({ ...valid(), timezone: "UTC" }).success).toBe(true);
    expect(restaurantSchema.safeParse({ ...valid(), timezone: "Mars/Olympus" }).success).toBe(false);
    expect(restaurantSchema.safeParse({ ...valid(), timezone: "" }).success).toBe(false);
  });

  it("валюта: три заглавные латинские буквы", () => {
    expect(restaurantSchema.safeParse({ ...valid(), currency: "usd" }).success).toBe(false);
    expect(restaurantSchema.safeParse({ ...valid(), currency: "EURO" }).success).toBe(false);
    expect(restaurantSchema.safeParse({ ...valid(), currency: "RUB" }).success).toBe(true);
  });

  it("часы: close <= open блокирует сохранение", () => {
    const v = valid();
    v.hours.days["1"] = { enabled: true, open: "18:00", close: "17:00" };
    expect(restaurantSchema.safeParse(v).success).toBe(false);
  });
});
