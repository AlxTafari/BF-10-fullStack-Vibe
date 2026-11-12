// Сценарии голосовых (S09, сессия 4): настоящий роутер, БД с seed, фейковые Telegram и LLM.
// Запуск (из supabase/functions):
//   deno test --allow-env --allow-net --allow-read --env-file=../../.env telegram-webhook/voice.integration.test.ts
// Без SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY пропускается.
import { assert, assertEquals } from "@std/assert";
import {
  AI_FALLBACK,
  MAIN_MENU_KEYBOARD,
  MENU_BOOKING,
  VOICE_AI_OFF,
  VOICE_FAILED,
  VOICE_MANAGER_TOO_LONG,
  VOICE_ON_STEP,
  VOICE_TOO_LONG,
  VOICE_UNCLEAR,
} from "../_shared/content.ts";
import { VOICE_MANAGER_MAX_SECONDS, VOICE_MAX_SECONDS, VOICE_PLACEHOLDER } from "../_shared/domain/voice.ts";
import { availableDates } from "../_shared/domain/bookingRules.ts";
import { freeHoursOn } from "../_shared/domain/bookingDraft.ts";
import { answer, call, createFakeLlm, type FakeLlm, type FakeLlmStep, type FakeTranscribeStep, heard, unclear } from "../_shared/llm/fakeLlm.ts";
import { createServiceClient } from "../_shared/supabaseClient.ts";
import { createFakeTelegram, type FakeTelegram } from "./testing/fakeTelegram.ts";
import { createTestGuest, type TestGuest } from "./testing/guest.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !enabled };

interface VoiceScenario {
  client: ReturnType<typeof createServiceClient>;
  tg: FakeTelegram;
  llm: FakeLlm;
  guest: TestGuest;
  /** Отправить голосовое; файл кладётся в фейковый Telegram (кроме withFile = false — «Telegram не отдал файл»). */
  voice(duration: number, withFile?: boolean): Promise<string>;
}

/** Гость с фейковой моделью: steps — ответы агента, transcriptions — ответы распознавателя. */
async function voiceScenario(
  steps: FakeLlmStep[],
  transcriptions: FakeTranscribeStep[],
  fn: (s: VoiceScenario) => Promise<void>,
): Promise<void> {
  const client = createServiceClient();
  const tg = createFakeTelegram();
  const llm = createFakeLlm(steps, "fake-model", transcriptions);
  const guest = createTestGuest(client, tg, { llm });
  let n = 0;
  const voice = async (duration: number, withFile = true) => {
    const fileId = `voice-${guest.id}-${n++}`;
    if (withFile) tg.putFile(fileId, new Uint8Array([0x4f, 0x67, 0x67, 0x53])); // «OggS» — содержимое фейку не важно
    await guest.voice(fileId, duration);
    return fileId;
  };
  try {
    await fn({ client, tg, llm, guest, voice });
    assertEquals(llm.remaining(), 0, "не все заготовленные ответы модели использованы");
  } finally {
    await guest.cleanup();
  }
}

/** Последнее входящее сообщение диалога — голосовое, как оно записалось в журнал. */
async function lastIncoming(s: VoiceScenario) {
  const { data, error } = await s.client.from("messages")
    .select("text, kind, meta")
    .eq("conversation_id", await s.guest.conversationId())
    .eq("direction", "in")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(1).single();
  if (error) throw error;
  return data as { text: string; kind: string; meta: { voice?: Record<string, unknown> } | null };
}

const downloads = (s: VoiceScenario) => s.tg.calls.filter((c) => c.method === "downloadFile").length;
const sentCount = (s: VoiceScenario) => s.tg.calls.filter((c) => c.method === "sendMessage").length;

async function firstRestaurantId(client: ReturnType<typeof createServiceClient>): Promise<string> {
  const { data, error } = await client.from("restaurants").select("id").order("created_at").limit(1).single();
  if (error) throw error;
  return data.id as string;
}

Deno.test({
  ...opts,
  name: "Голос: распознан → расшифровка в журнале вместо заглушки → ответ агента на неё",
  fn: () =>
    voiceScenario([answer("Горячее: дорада и осьминог на гриле.")], [heard("че есть горячего")], async (s) => {
      await s.guest.text("/start");
      const fileId = await s.voice(5);

      assertEquals(s.guest.screen().text, "Горячее: дорада и осьминог на гриле.");
      const row = await lastIncoming(s);
      assertEquals([row.text, row.kind], ["че есть горячего", "text"]);
      assertEquals(row.meta?.voice?.fileId, fileId);
      assertEquals(row.meta?.voice?.duration, 5);
      assertEquals(row.meta?.voice?.transcribedBy, "auto");
      assertEquals(row.meta?.voice?.model, "fake-model");
      assertEquals(row.meta?.voice?.inputTokens, 320, "расход распознавания записан");
      // Агент получил расшифровку последней репликой гостя — как обычный текст.
      const lastUser = s.llm.requests[0].messages.filter((m) => m.role === "user").at(-1);
      assertEquals(lastUser && "text" in lastUser ? lastUser.text : null, "че есть горячего");
      assertEquals(s.llm.transcribeRequests[0].mimeType, "audio/ogg");
    }),
});

Deno.test({
  ...opts,
  name: "Голос: речь не разобрать → «не расслышал», заглушка с причиной, агент не вызывается",
  fn: () =>
    voiceScenario([], [unclear()], async (s) => {
      await s.guest.text("/start");
      await s.voice(3);
      assertEquals(s.guest.screen().text, VOICE_UNCLEAR);
      const row = await lastIncoming(s);
      assertEquals(row.text, VOICE_PLACEHOLDER);
      assertEquals(row.meta?.voice?.transcribeError, "unclear");
      assertEquals(row.meta?.voice?.transcribedBy, undefined);
      assertEquals(s.llm.requests.length, 0);
    }),
});

Deno.test({
  ...opts,
  name: "Голос: модель недоступна → запасной ответ с главным меню, причина в журнале",
  fn: () =>
    voiceScenario([], [{ error: "quota" }], async (s) => {
      await s.guest.text("/start");
      await s.voice(3);
      assertEquals(s.guest.screen().text, VOICE_FAILED);
      assertEquals(s.guest.screen().keyboard, MAIN_MENU_KEYBOARD);
      assertEquals((await lastIncoming(s)).meta?.voice?.transcribeError, "quota");
    }),
});

Deno.test({
  ...opts,
  name: "Голос: Telegram не отдал файл → запасной ответ, модель не вызывается",
  fn: () =>
    voiceScenario([], [], async (s) => {
      await s.guest.text("/start");
      await s.voice(3, false);
      assertEquals(s.guest.screen().text, VOICE_FAILED);
      assertEquals((await lastIncoming(s)).meta?.voice?.transcribeError, "download");
      assertEquals(s.llm.transcribeRequests.length, 0);
    }),
});

Deno.test({
  ...opts,
  name: "Голос: длиннее минуты → «запишите покороче», файл не скачивается, голосовое в журнале",
  fn: () =>
    voiceScenario([], [], async (s) => {
      await s.guest.text("/start");
      await s.voice(VOICE_MAX_SECONDS + 1);
      assertEquals(s.guest.screen().text, VOICE_TOO_LONG);
      assertEquals(downloads(s), 0);
      const row = await lastIncoming(s);
      assertEquals([row.text, row.meta?.voice?.duration], [VOICE_PLACEHOLDER, VOICE_MAX_SECONDS + 1]);
    }),
});

Deno.test({
  ...opts,
  name: "Голос: менеджер в диалоге → бот молчит и не распознаёт, голосовое в журнале; длиннее 2 минут — просьба покороче",
  fn: () =>
    voiceScenario([], [], async (s) => {
      await s.guest.text("/start");
      const { error } = await s.client.from("conversations")
        .update({ handoff_until: new Date(Date.now() + 30 * 60_000).toISOString() })
        .eq("id", await s.guest.conversationId());
      if (error) throw error;
      const before = sentCount(s);

      // Длиннее минуты, но в пределе менеджера: принимается.
      const fileId = await s.voice(VOICE_MAX_SECONDS + 30);
      assertEquals(sentCount(s), before, "бот не отвечает");
      assertEquals(downloads(s), 0, "в ручном режиме не распознаём");
      const row = await lastIncoming(s);
      assertEquals([row.text, row.kind, row.meta?.voice?.fileId], [VOICE_PLACEHOLDER, "text", fileId]);

      // Длиннее 2 минут — просьба покороче; голосовое всё равно в журнале.
      const longId = await s.voice(VOICE_MANAGER_MAX_SECONDS + 1);
      assertEquals(s.guest.screen().text, VOICE_MANAGER_TOO_LONG);
      assertEquals((await lastIncoming(s)).meta?.voice?.fileId, longId);
    }),
});

Deno.test({
  ...opts,
  name: "Голос: на шаге брони → «напишите текстом», черновик и шаг не меняются",
  fn: () =>
    voiceScenario([], [], async (s) => {
      await s.guest.text("/start");
      await s.guest.tap(MENU_BOOKING);
      const conversationId = await s.guest.conversationId();
      const stateOf = async () => (await s.client.from("conversations").select("state").eq("id", conversationId).single()).data?.state;
      const stateBefore = await stateOf();

      await s.voice(3);
      assertEquals(s.guest.screen().text, VOICE_ON_STEP);
      assertEquals(await stateOf(), stateBefore);
      assertEquals(downloads(s), 0);
    }),
});

Deno.test({
  ...opts,
  name: "Голос: AI ресторана выключен → «напишите текстом» с главным меню, модель не вызывается",
  fn: async () => {
    const client = createServiceClient();
    const restaurantId = await firstRestaurantId(client);
    const { data: before } = await client.from("restaurant_ai_settings").select("ai_enabled").eq("restaurant_id", restaurantId).single();
    await client.from("restaurant_ai_settings").update({ ai_enabled: false }).eq("restaurant_id", restaurantId);
    try {
      await voiceScenario([], [], async (s) => {
        await s.guest.text("/start");
        await s.voice(3);
        assertEquals(s.guest.screen().text, VOICE_AI_OFF);
        assertEquals(s.guest.screen().keyboard, MAIN_MENU_KEYBOARD);
        assertEquals(downloads(s), 0);
        assertEquals((await lastIncoming(s)).text, VOICE_PLACEHOLDER);
      });
    } finally {
      await client.from("restaurant_ai_settings").update({ ai_enabled: before?.ai_enabled ?? true }).eq("restaurant_id", restaurantId);
    }
  },
});

Deno.test({
  ...opts,
  name: "Голос: суточный лимит исчерпан → не распознаём, ответ как при лимите",
  fn: () =>
    voiceScenario([], [], async (s) => {
      await s.guest.text("/start");
      // Лимит не трогаем (настройка общая для параллельных тестов): дописываем диалогу столько ответов агента, сколько он позволяет.
      const restaurantId = await firstRestaurantId(s.client);
      const { data: settings } = await s.client.from("restaurant_ai_settings").select("daily_turn_limit").eq("restaurant_id", restaurantId).single();
      const limit = (settings?.daily_turn_limit as number | undefined) ?? 50;
      const conversationId = await s.guest.conversationId();
      const rows = Array.from({ length: limit }, () => ({
        conversation_id: conversationId,
        direction: "out",
        kind: "text",
        text: "ответ агента",
        meta: { ai: true, model: "fake-model", tools: [], calls: 1, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, ms: 0 },
      }));
      const { error } = await s.client.from("messages").insert(rows);
      if (error) throw error;

      await s.voice(3);
      assertEquals(s.guest.screen().text, AI_FALLBACK);
      assertEquals(downloads(s), 0, "распознавание не оплачено зря");
      const { data: out } = await s.client.from("messages").select("meta").eq("conversation_id", conversationId)
        .eq("direction", "out").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).single();
      assert((out?.meta as { aiFallback?: string } | null)?.aiFallback === "limit");
    }),
});

/** Первый слот, на который сейчас можно забронировать (как в ai.integration.test.ts): тест не зависит от дня запуска. */
async function bookableSlot(client: ReturnType<typeof createServiceClient>): Promise<{ date: string; time: string }> {
  const { data: r, error } = await client.from("restaurants").select("timezone, opening_hours").order("created_at").limit(1).single();
  if (error) throw error;
  const env = { now: new Date(), timeZone: r.timezone as string, openingHours: r.opening_hours };
  for (const date of availableDates(env)) {
    const hours = freeHoursOn(date, env);
    if (hours.length > 0) return { date, time: hours[0] };
  }
  throw new Error("нет свободных слотов в ближайшие дни");
}

Deno.test({
  ...opts,
  name: "Голос на карточке брони: «нас будет четверо» → распознано → агент меняет гостей → карточка с ✏️",
  fn: async () => {
    const client = createServiceClient();
    const slot = await bookableSlot(client);
    await voiceScenario([
      call("draftBooking", { date: slot.date, time: slot.time, guests: 3, name: "Анна", contact: "+302310000000" }),
      answer("Проверьте заявку."),
      call("draftBooking", { guests: 4 }),
      answer("Исправил: 4 гостя."),
    ], [heard("нас будет четверо")], async (s) => {
      await s.guest.text("стол на троих, Анна, +302310000000");
      assert(s.guest.screen().text.startsWith("Проверьте заявку"));
      await s.voice(4);
      assert(s.guest.screen().text.includes("👥 Гостей: 4 ✏️"), s.guest.screen().text);
      assertEquals((await lastIncoming(s)).text, "нас будет четверо");
    });
  },
});

