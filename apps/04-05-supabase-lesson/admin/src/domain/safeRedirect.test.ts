import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safeRedirect";

describe("safeRedirect", () => {
  it("пропускает внутренние пути", () => {
    expect(safeRedirect("/menu")).toBe("/menu");
    expect(safeRedirect("/menu/abc?edit=1")).toBe("/menu/abc?edit=1");
  });

  it("внешние адреса и обходные формы → запасной путь", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "evil.example",
      "/ok\n//evil",
      "",
    ]) {
      expect(safeRedirect(bad)).toBe("/");
    }
  });

  it("не-строка → запасной путь", () => {
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect(42)).toBe("/");
    expect(safeRedirect(["/menu"])).toBe("/");
  });

  it("/login не используется как цель возврата", () => {
    expect(safeRedirect("/login")).toBe("/");
    expect(safeRedirect("/login?redirect=/menu")).toBe("/");
  });
});
