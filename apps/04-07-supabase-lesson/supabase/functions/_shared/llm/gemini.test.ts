import { assertEquals } from "@std/assert";
import { parseTranscription, quotaNames } from "./gemini.ts";

Deno.test("quotaNames: имена лимитов из текста 429, без остального текста", () => {
  const message = `{"error":{"code":429,"message":"You exceeded your current quota. Quota exceeded for metric: ` +
    `generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 10","details":[{"violations":` +
    `[{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests",` +
    `"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}`;
  assertEquals(quotaNames(message), [
    "generativelanguage.googleapis.com/generate_content_free_tier_requests",
    "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
  ]);
});

Deno.test("quotaNames: в тексте нет имён — пусто", () => {
  assertEquals(quotaNames("Resource has been exhausted"), []);
});

Deno.test("parseTranscription: JSON нужной формы", () => {
  assertEquals(parseTranscription('{"text":"стол на завтра","unclear":false}'), { text: "стол на завтра", unclear: false });
  assertEquals(parseTranscription('{"text":"","unclear":true}'), { text: "", unclear: true });
});

Deno.test("parseTranscription: не JSON, не та форма, пусто — null", () => {
  assertEquals(parseTranscription(undefined), null);
  assertEquals(parseTranscription("стол на завтра"), null);
  assertEquals(parseTranscription('{"text":"x"}'), null);
  assertEquals(parseTranscription('{"text":1,"unclear":false}'), null);
  assertEquals(parseTranscription("null"), null);
});
