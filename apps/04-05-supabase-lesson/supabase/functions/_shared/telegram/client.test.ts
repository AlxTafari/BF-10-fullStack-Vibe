import { assertEquals } from "jsr:@std/assert@1";
import { isMessageGoneError, isNotModifiedError, TelegramApiError } from "./client.ts";

const e = (code: number, description: string) => new TelegramApiError("editMessageText", code, description);

Deno.test("isNotModifiedError: только 400 «message is not modified»", () => {
  assertEquals(isNotModifiedError(e(400, "Bad Request: message is not modified: specified new message content")), true);
  assertEquals(isNotModifiedError(e(400, "Bad Request: message to edit not found")), false);
  assertEquals(isNotModifiedError(new Error("message is not modified")), false);
});

Deno.test("isMessageGoneError: не найдено / нельзя править", () => {
  assertEquals(isMessageGoneError(e(400, "Bad Request: message to edit not found")), true);
  assertEquals(isMessageGoneError(e(400, "Bad Request: message can't be edited")), true);
  assertEquals(isMessageGoneError(e(400, "Bad Request: message is not modified")), false);
  assertEquals(isMessageGoneError(e(429, "Too Many Requests")), false);
  assertEquals(isMessageGoneError(new Error("message to edit not found")), false);
});

Deno.test("прочие ошибки не классифицируются как «не изменилось»/«нет сообщения»", () => {
  const other = e(500, "Internal Server Error");
  assertEquals(isNotModifiedError(other) || isMessageGoneError(other), false);
});
