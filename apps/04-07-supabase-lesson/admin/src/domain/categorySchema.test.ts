import { describe, expect, it } from "vitest";
import { categorySchema } from "./categorySchema";

describe("categorySchema", () => {
  it("1–80 символов, trim", () => {
    expect(categorySchema.safeParse({ name: "Супы" }).success).toBe(true);
    expect(categorySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(categorySchema.safeParse({ name: "я".repeat(80) }).success).toBe(true);
    expect(categorySchema.safeParse({ name: "я".repeat(81) }).success).toBe(false);
  });
});
