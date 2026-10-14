import { describe, expect, it } from "vitest";
import { contactLink } from "./contactLink";

describe("contactLink", () => {
  it("@username → t.me", () => {
    expect(contactLink("@anna_k")).toEqual({ kind: "telegram", href: "https://t.me/anna_k" });
  });
  it("телефон с украшениями → tel: из цифр", () => {
    expect(contactLink("+7 (999) 123-45-67")).toEqual({ kind: "phone", href: "tel:+79991234567" });
    expect(contactLink("30 2310 123456")).toEqual({ kind: "phone", href: "tel:302310123456" });
  });
  it("слишком короткий username и мусор — без ссылки", () => {
    expect(contactLink("@ab")).toBeNull();
    expect(contactLink("anna")).toBeNull();
    expect(contactLink("")).toBeNull();
  });
  it("опасные строки никогда не становятся ссылкой", () => {
    for (const evil of ["javascript:alert(1)", "https://evil.example", "@anna_k/../x", "+79991234567<script>", "tel:+7999123456"]) {
      expect(contactLink(evil)).toBeNull();
    }
  });
  it("пробелы по краям игнорируются", () => {
    expect(contactLink("  @anna_k  ")?.href).toBe("https://t.me/anna_k");
  });
});
