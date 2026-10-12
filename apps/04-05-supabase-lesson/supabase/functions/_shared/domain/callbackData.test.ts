import { assertEquals } from "jsr:@std/assert@1";
import { buildCallback, parseCallback } from "./callbackData.ts";

const ID = "00000000-0000-0000-0000-00000000b001";

Deno.test("build и parse обратимы", () => {
  for (const kind of ["faq", "category", "dish"] as const) {
    assertEquals(parseCallback(buildCallback(kind, ID)), { kind, id: ID });
  }
});

Deno.test("callback_data укладывается в 64 байта", () => {
  assertEquals(new TextEncoder().encode(buildCallback("category", ID)).length <= 64, true);
});

Deno.test("мусор → null", () => {
  assertEquals(parseCallback("dish:не-uuid"), null);
  assertEquals(parseCallback("dish:"), null);
  assertEquals(parseCallback(`unknown:${ID}`), null);
  assertEquals(parseCallback(`dish:${ID}:extra`), null);
  assertEquals(parseCallback("menu:info"), null);
});
