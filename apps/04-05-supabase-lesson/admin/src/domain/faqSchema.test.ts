import { describe, expect, it } from "vitest";
import { EMPTY_FAQ, faqSchema } from "./faqSchema";

describe("faqSchema", () => {
  const ok = { question: "Есть ли парковка?", answer: "Да, во дворе.", is_published: true };

  it("валидная запись проходит; пробелы обрезаются", () => {
    const r = faqSchema.safeParse({ ...ok, question: "  Вопрос  " });
    expect(r.success && r.data.question).toBe("Вопрос");
  });

  it("пустые и из одних пробелов — ошибка", () => {
    expect(faqSchema.safeParse({ ...ok, question: "   " }).success).toBe(false);
    expect(faqSchema.safeParse({ ...ok, answer: "" }).success).toBe(false);
  });

  it("лимиты 300 / 2000", () => {
    expect(faqSchema.safeParse({ ...ok, question: "в".repeat(300) }).success).toBe(true);
    expect(faqSchema.safeParse({ ...ok, question: "в".repeat(301) }).success).toBe(false);
    expect(faqSchema.safeParse({ ...ok, answer: "о".repeat(2000) }).success).toBe(true);
    expect(faqSchema.safeParse({ ...ok, answer: "о".repeat(2001) }).success).toBe(false);
  });

  it("новая запись по умолчанию опубликована, но пустая — не валидна", () => {
    expect(EMPTY_FAQ.is_published).toBe(true);
    expect(faqSchema.safeParse(EMPTY_FAQ).success).toBe(false);
  });
});
