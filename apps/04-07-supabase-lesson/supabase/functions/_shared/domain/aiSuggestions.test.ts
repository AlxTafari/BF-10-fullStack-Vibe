import { assertEquals } from "@std/assert";
import { parseSuggestions } from "./aiSuggestions.ts";

const DISH = "11111111-2222-3333-4444-555555555555";

Deno.test("parseSuggestions: знакомые действия проходят", () => {
  assertEquals(parseSuggestions([{ kind: "booking" }, { kind: "dish", dishId: DISH }]), [
    { kind: "booking" },
    { kind: "dish", dishId: DISH },
  ]);
});

Deno.test("parseSuggestions: чужое отбрасывается, ход не падает", () => {
  assertEquals(parseSuggestions("booking"), []);
  assertEquals(parseSuggestions(null), []);
  assertEquals(
    parseSuggestions([
      { kind: "delete_everything" },
      { kind: "dish" },
      { kind: "dish", dishId: "not-a-uuid" },
      null,
      "menu",
      { kind: "menu", url: "https://evil.example" },
    ]),
    [{ kind: "menu" }],
  );
});

Deno.test("parseSuggestions: без дублей и не больше трёх", () => {
  const raw = [
    { kind: "menu" },
    { kind: "menu" },
    { kind: "dish", dishId: DISH },
    { kind: "dish", dishId: DISH.toUpperCase() },
    { kind: "booking" },
    { kind: "manager" },
  ];
  assertEquals(parseSuggestions(raw), [{ kind: "menu" }, { kind: "dish", dishId: DISH }, { kind: "booking" }]);
});
