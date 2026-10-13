import { assertEquals } from "jsr:@std/assert@1";
import { buildCallback, buildFlowCallback, parseCallback, parseFlowCallback } from "./callbackData.ts";

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

Deno.test("flow-кнопка: build → parse", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const data = buildFlowCallback(id, "d=2026-10-20");
  assertEquals(parseFlowCallback(data), { draftId: id, action: "d=2026-10-20" });
  // Укладываемся в лимит Telegram: 64 байта.
  assertEquals(new TextEncoder().encode(buildFlowCallback(id, "k=manager_request")).length <= 64, true);
});

Deno.test("flow-кнопка: битые и поддельные данные → null", () => {
  assertEquals(parseFlowCallback("flow:не-uuid:send"), null);
  assertEquals(parseFlowCallback("flow:11111111-2222-3333-4444-555555555555"), null);
  assertEquals(parseFlowCallback("flow:11111111-2222-3333-4444-555555555555:a:b"), null);
  assertEquals(parseFlowCallback("faq:11111111-2222-3333-4444-555555555555"), null);
});
