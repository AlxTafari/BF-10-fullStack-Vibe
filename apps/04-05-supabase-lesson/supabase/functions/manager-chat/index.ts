import { createClient } from "@supabase/supabase-js";
import { createLlmFromEnv } from "../_shared/services/ai/llm.ts";
import { joinChat, leaveChat, type ManagerChatDeps, sendManagerReply } from "../_shared/services/managerChat.ts";
import { type DownloadFile, getVoiceAudio, transcribeVoiceMessage } from "../_shared/services/voiceMessages.ts";
import { createServiceClient } from "../_shared/supabaseClient.ts";
import { createTelegramClient, TelegramApiError } from "../_shared/telegram/client.ts";

// Менеджер в диалоге (S06b): подключение, ответ гостю, отключение. Голосовые гостя (S09, сессия 4): звук для плеера
// и распознавание по кнопке — подключаться к чату для них не нужно. Вызывает админка (supabase.functions.invoke).
// verify_jwt = true (по умолчанию): без токена Supabase не пропустит запрос сюда. Членство в ресторане проверяют
// RPC и RLS под JWT менеджера — здесь только разбор запроса и Telegram.
// Тело: { action: "join" | "leave", conversation_id }, { action: "reply", conversation_id, text }
// или { action: "voice_audio" | "voice_transcribe", message_id }.

// Админка живёт на другом домене (GitHub Pages / localhost): браузер сначала шлёт preflight OPTIONS.
// Авторизация — заголовком, не cookie, поэтому «*» безопасно: чужой сайт без токена менеджера ничего не сделает.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

/** Ошибка сервиса → HTTP-статус. Код ошибки в теле — его разбирает админка. */
const ERROR_STATUS = {
  not_found: 404,
  handoff_inactive: 409,
  invalid_text: 400,
  not_voice: 400,
  // Голосовые: Telegram не отдал файл / Gemini не настроен / файл больше предела / речь не разобрать / сбой модели.
  unavailable: 502,
  ai_unavailable: 503,
  too_big: 413,
  unclear: 422,
  failed: 502,
} as const;

const CHAT_ACTIONS = ["join", "reply", "leave"];
const VOICE_ACTIONS = ["voice_audio", "voice_transcribe"];

/** Предел файла для прослушивания: столько отдаёт getFile у Telegram. Голосовое до 2 минут — около 1 МБ. */
const LISTEN_MAX_BYTES = 20 * 1024 * 1024;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  let body: { action?: unknown; conversation_id?: unknown; message_id?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const action = String(body.action);
  // Действия чата адресуются диалогом, голосовые — сообщением.
  const targetId = CHAT_ACTIONS.includes(action) ? body.conversation_id : VOICE_ACTIONS.includes(action) ? body.message_id : undefined;
  if (typeof targetId !== "string") return json({ error: "bad_request" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!url || !anonKey || !botToken) {
    console.error("manager-chat: SUPABASE_URL / SUPABASE_ANON_KEY / TELEGRAM_BOT_TOKEN не заданы");
    return json({ error: "misconfigured" }, 500);
  }

  // Клиент «от имени менеджера»: anon key + его токен — RPC видят auth.uid() и проверяют членство.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  // Кто пишет — для meta.managerId. Токен уже проверен шлюзом (verify_jwt), здесь берём из него пользователя.
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const tg = createTelegramClient(botToken);
  const deps: ManagerChatDeps = {
    userClient,
    serviceClient: createServiceClient(),
    // Telegram-ошибки разбираются здесь, а не в сервисе (ADR-008): 403 — гость заблокировал бота.
    deliver: async (chatId, text) => {
      try {
        await tg.sendMessage(chatId, text);
        return "sent";
      } catch (error) {
        if (error instanceof TelegramApiError && error.errorCode === 403) return "blocked";
        console.error("manager-chat: отправка гостю не удалась", error);
        return "failed";
      }
    },
  };

  // Скачивание голосового по file_id. Ошибку Telegram разбираем здесь (ADR-008), в лог — только код.
  const download: DownloadFile = async (fileId) => {
    try {
      return (await tg.downloadFile(fileId, LISTEN_MAX_BYTES)).bytes;
    } catch (error) {
      console.error("manager-chat: голосовое не скачано", error instanceof TelegramApiError ? `telegram ${error.errorCode}` : "network");
      return null;
    }
  };

  try {
    if (action === "voice_audio") {
      const audio = await getVoiceAudio({ userClient, download }, targetId);
      if (!audio.ok) return json({ error: audio.error }, ERROR_STATUS[audio.error]);
      // octet-stream, а не audio/ogg: supabase-js (functions.invoke) отдаёт Blob только для octet-stream, остальное
      // читает как текст и портит байты. Тип для плеера админка ставит сама.
      // slice(): копия с типом Uint8Array<ArrayBuffer> — Response не принимает Uint8Array<ArrayBufferLike> (типы TS 5.7+).
      return new Response(audio.bytes.slice(), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=3600" },
      });
    }
    const result = action === "voice_transcribe"
      ? await transcribeVoiceMessage({ userClient, serviceClient: deps.serviceClient, download, llm: createLlmFromEnv() }, targetId)
      : action === "join"
      ? await joinChat(deps, targetId)
      : action === "leave"
      ? await leaveChat(deps, targetId)
      : await sendManagerReply(deps, { conversationId: targetId, managerId: userData.user.id, text: body.text });
    if (!result.ok) return json({ error: result.error }, ERROR_STATUS[result.error]);
    return json(result);
  } catch (error) {
    console.error("manager-chat: сбой", error);
    return json({ error: "internal" }, 500);
  }
});
