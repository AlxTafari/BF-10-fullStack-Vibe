import { describe, expect, it } from "vitest";
import { loginSchema } from "./loginSchema";

describe("loginSchema", () => {
  it("валидные данные проходят, email trim'ится", () => {
    const r = loginSchema.safeParse({ email: "  a@b.co ", password: " p " });
    expect(r.success && r.data).toEqual({ email: "a@b.co", password: " p " });
  });

  it("пустые поля и мусорный email отклоняются", () => {
    expect(loginSchema.safeParse({ email: "", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "abc", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});
