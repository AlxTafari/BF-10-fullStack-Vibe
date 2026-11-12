import { assertEquals } from "@std/assert";
import {
  canTranscribeFile,
  normalizeTranscript,
  routeVoice,
  VOICE_MANAGER_MAX_SECONDS,
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  VOICE_TRANSCRIPT_MAX_LENGTH,
  type VoiceRouteInput,
} from "./voice.ts";

const base: VoiceRouteInput = { durationSec: 10, hasLiveFlow: false, handoffActive: false, aiAvailable: true };

Deno.test("routeVoice: вне сценария при включённом AI — агенту", () => {
  assertEquals(routeVoice(base), "agent");
  assertEquals(routeVoice({ ...base, durationSec: VOICE_MAX_SECONDS }), "agent");
});

Deno.test("routeVoice: длиннее предела — too_long", () => {
  assertEquals(routeVoice({ ...base, durationSec: VOICE_MAX_SECONDS + 1 }), "too_long");
  assertEquals(routeVoice({ ...base, fileSize: VOICE_MAX_BYTES + 1 }), "too_long");
});

Deno.test("routeVoice: шаг сценария — text_only, даже в ручном режиме и при длинном голосовом", () => {
  assertEquals(routeVoice({ ...base, hasLiveFlow: true }), "text_only");
  assertEquals(routeVoice({ ...base, hasLiveFlow: true, handoffActive: true }), "text_only");
  assertEquals(routeVoice({ ...base, hasLiveFlow: true, durationSec: 600 }), "text_only");
});

Deno.test("routeVoice: ручной режим — manager независимо от AI, до своего предела длины", () => {
  assertEquals(routeVoice({ ...base, handoffActive: true }), "manager");
  assertEquals(routeVoice({ ...base, handoffActive: true, aiAvailable: false }), "manager");
  assertEquals(routeVoice({ ...base, handoffActive: true, durationSec: VOICE_MANAGER_MAX_SECONDS }), "manager");
  assertEquals(routeVoice({ ...base, handoffActive: true, durationSec: VOICE_MANAGER_MAX_SECONDS + 1 }), "manager_too_long");
});

Deno.test("routeVoice: AI выключен — text_only, длина не важна", () => {
  assertEquals(routeVoice({ ...base, aiAvailable: false }), "text_only");
  assertEquals(routeVoice({ ...base, aiAvailable: false, durationSec: 600 }), "text_only");
});

Deno.test("canTranscribeFile: предел только по размеру", () => {
  assertEquals(canTranscribeFile(undefined), true);
  assertEquals(canTranscribeFile(VOICE_MAX_BYTES), true);
  assertEquals(canTranscribeFile(VOICE_MAX_BYTES + 1), false);
});

Deno.test("normalizeTranscript: unclear и пустота — null", () => {
  assertEquals(normalizeTranscript({ text: "что-то", unclear: true }), null);
  assertEquals(normalizeTranscript({ text: "  \n ", unclear: false }), null);
});

Deno.test("normalizeTranscript: пробелы схлопываются, длинное режется", () => {
  assertEquals(normalizeTranscript({ text: " стол на\n\nзавтра  в 19 ", unclear: false }), "стол на завтра в 19");
  const long = normalizeTranscript({ text: "а".repeat(VOICE_TRANSCRIPT_MAX_LENGTH + 50), unclear: false })!;
  assertEquals(long.length, VOICE_TRANSCRIPT_MAX_LENGTH + 1);
  assertEquals(long.endsWith("…"), true);
});
