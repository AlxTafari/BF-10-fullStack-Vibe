import { assertEquals } from "jsr:@std/assert@1";
import { normalizeSearchQuery, toLikePattern } from "./searchQuery.ts";

Deno.test("trim и схлопывание пробелов", () => {
  assertEquals(normalizeSearchQuery("  мидии   саганаки "), "мидии саганаки");
});

Deno.test("слишком короткий и пустой запрос → null", () => {
  assertEquals(normalizeSearchQuery("а"), null);
  assertEquals(normalizeSearchQuery("   "), null);
});

Deno.test("слишком длинный запрос → null", () => {
  assertEquals(normalizeSearchQuery("а".repeat(51)), null);
  assertEquals(normalizeSearchQuery("а".repeat(50)), "а".repeat(50));
});

Deno.test("спецсимволы LIKE экранируются", () => {
  assertEquals(toLikePattern("100%_а\\"), "%100\\%\\_а\\\\%");
  assertEquals(toLikePattern("осьминог"), "%осьминог%");
});
