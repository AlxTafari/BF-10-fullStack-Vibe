// Голосовые в админке (S09, сессия 4): прослушивание и распознавание по кнопке менеджера на dev-БД.
// Что проверяем: RLS (чужой менеджер — not_found), запись расшифровки и расхода, повторное нажатие без модели,
// отказы (не голосовое, Gemini не настроен, Telegram не отдал файл, речь не разобрать).
// Запуск (из supabase/functions):
//   deno test --allow-env --allow-net --allow-read --env-file=../../.env _shared/services/voiceMessages.integration.test.ts
// Без SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY пропускается. Данные свои, чистятся в конце.
import { assertEquals } from "@std/assert";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { VOICE_PLACEHOLDER } from "../domain/voice.ts";
import { createFakeLlm, heard, unclear } from "../llm/fakeLlm.ts";
import { createServiceClient } from "../supabaseClient.ts";
import { type DownloadFile, getVoiceAudio, transcribeVoiceMessage } from "./voiceMessages.ts";

const url = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const enabled = !!url && !!anonKey && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const AUDIO = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);

Deno.test({
  name: "Голосовые в админке: прослушивание и распознавание по кнопке",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const service = createServiceClient();
    const runId = crypto.randomUUID().slice(0, 8);
    const userIds: string[] = [];
    const restaurantIds: string[] = [];

    async function manager(label: string, restaurantId: string): Promise<SupabaseClient> {
      const email = `voice-${label}-${runId}@example.test`;
      const password = `pw-${crypto.randomUUID()}`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`user ${label}: ${created.error?.message}`);
      userIds.push(created.data.user.id);
      await service.from("restaurant_managers").insert({ user_id: created.data.user.id, restaurant_id: restaurantId });
      const client = createClient(url!, anonKey!, AUTH_OPTS);
      const res = await client.auth.signInWithPassword({ email, password });
      if (res.error) throw new Error(`sign in ${label}: ${res.error.message}`);
      return client;
    }

    async function restaurant(label: string): Promise<string> {
      const res = await service.from("restaurants").insert({ name: `voice-test-${label}-${runId}` }).select("id").single();
      if (res.error) throw new Error(res.error.message);
      restaurantIds.push(res.data.id);
      return res.data.id;
    }

    /** Входящее сообщение; meta.voice — если голосовое. */
    async function message(conversationId: string, voice: Record<string, unknown> | null): Promise<string> {
      const res = await service.from("messages").insert({
        conversation_id: conversationId,
        direction: "in",
        kind: "text",
        text: voice ? VOICE_PLACEHOLDER : "обычный текст",
        meta: voice ? { voice } : null,
      }).select("id").single();
      if (res.error) throw new Error(res.error.message);
      return res.data.id;
    }

    async function row(id: string) {
      const res = await service.from("messages").select("text, meta").eq("id", id).single();
      if (res.error) throw new Error(res.error.message);
      return res.data as { text: string; meta: { voice: Record<string, unknown> } };
    }

    try {
      const restaurantA = await restaurant("A");
      const restaurantB = await restaurant("B");
      const managerA = await manager("a", restaurantA);
      const managerB = await manager("b", restaurantB);
      const conv = await service.from("conversations")
        .insert({ restaurant_id: restaurantA, external_user_id: -Date.now() % 1_000_000_000, chat_id: -1, display_name: "voice-test" })
        .select("id").single();
      if (conv.error) throw new Error(conv.error.message);
      const conversationId = conv.data.id as string;

      // Фейковый Telegram: файл «missing» он не отдаёт. Promise.resolve — без async, ждать нечего (lint require-await).
      const download: DownloadFile = (fileId) => Promise.resolve(fileId === "missing" ? null : AUDIO);

      await t.step("прослушивание: свой менеджер получает байты, чужой — not_found", async () => {
        const id = await message(conversationId, { fileId: "f1", duration: 12, mimeType: "audio/ogg" });
        const own = await getVoiceAudio({ userClient: managerA, download }, id);
        assertEquals(own, { ok: true, bytes: AUDIO, mimeType: "audio/ogg" });
        assertEquals(await getVoiceAudio({ userClient: managerB, download }, id), { ok: false, error: "not_found" });
      });

      await t.step("распознавание: текст вместо заглушки, расход и transcribedBy в meta; повтор — без модели", async () => {
        const id = await message(conversationId, { fileId: "f2", duration: 5, transcribeError: "quota" });
        const llm = createFakeLlm([], "fake-model", [heard("хочу стол на завтра")]);
        const deps = { userClient: managerA, serviceClient: service, download, llm };

        assertEquals(await transcribeVoiceMessage(deps, id), { ok: true, text: "хочу стол на завтра" });
        const saved = await row(id);
        assertEquals(saved.text, "хочу стол на завтра");
        assertEquals(saved.meta.voice.transcribedBy, "manager");
        assertEquals(saved.meta.voice.transcribeError, undefined, "прежняя ошибка снята");
        assertEquals(saved.meta.voice.inputTokens, 320);
        assertEquals(saved.meta.voice.fileId, "f2", "file_id сохранён — прослушать можно и дальше");

        // Второе нажатие: очередь распознавателя пуста — вызов модели уронил бы тест.
        assertEquals(await transcribeVoiceMessage(deps, id), { ok: true, text: "хочу стол на завтра" });
        assertEquals(llm.transcribeRequests.length, 1);
      });

      await t.step("распознавание: чужой менеджер — not_found, сообщение не тронуто", async () => {
        const id = await message(conversationId, { fileId: "f3", duration: 5 });
        const llm = createFakeLlm([], "fake-model", []);
        const result = await transcribeVoiceMessage({ userClient: managerB, serviceClient: service, download, llm }, id);
        assertEquals(result, { ok: false, error: "not_found" });
        assertEquals((await row(id)).text, VOICE_PLACEHOLDER);
      });

      await t.step("отказы: не голосовое, Gemini не настроен, Telegram не отдал файл", async () => {
        const deps = { userClient: managerA, serviceClient: service, download };
        const text = await message(conversationId, null);
        assertEquals(await transcribeVoiceMessage({ ...deps, llm: createFakeLlm([]) }, text), { ok: false, error: "not_voice" });

        const voice = await message(conversationId, { fileId: "f4", duration: 5 });
        assertEquals(await transcribeVoiceMessage({ ...deps, llm: null }, voice), { ok: false, error: "ai_unavailable" });

        const missing = await message(conversationId, { fileId: "missing", duration: 5 });
        assertEquals(await transcribeVoiceMessage({ ...deps, llm: createFakeLlm([]) }, missing), { ok: false, error: "unavailable" });
      });

      await t.step("речь не разобрать: unclear, заглушка остаётся, оплаченный расход записан", async () => {
        const id = await message(conversationId, { fileId: "f5", duration: 5 });
        const llm = createFakeLlm([], "fake-model", [unclear()]);
        const result = await transcribeVoiceMessage({ userClient: managerA, serviceClient: service, download, llm }, id);
        assertEquals(result, { ok: false, error: "unclear" });
        const saved = await row(id);
        assertEquals(saved.text, VOICE_PLACEHOLDER);
        assertEquals(saved.meta.voice.transcribeError, "unclear");
        assertEquals(saved.meta.voice.inputTokens, 320);
      });
    } finally {
      // Диалоги и сообщения уходят каскадом вместе с рестораном.
      if (restaurantIds.length > 0) await service.from("restaurants").delete().in("id", restaurantIds);
      for (const id of userIds) await service.auth.admin.deleteUser(id);
    }
  },
});
