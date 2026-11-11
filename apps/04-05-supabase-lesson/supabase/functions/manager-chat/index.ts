import { createClient } from "@supabase/supabase-js";
import { joinChat, leaveChat, type ManagerChatDeps, sendManagerReply } from "../_shared/services/managerChat.ts";
import { createServiceClient } from "../_shared/supabaseClient.ts";
import { createTelegramClient, TelegramApiError } from "../_shared/telegram/client.ts";

// Менеджер в диалоге (S06b): подключение, ответ гостю, отключение. Вызывает админка (supabase.functions.invoke).
// verify_jwt = true (по умолчанию): без токена Supabase не пропустит запрос сюда. Членство в ресторане проверяют
// RPC под JWT менеджера — здесь только разбор запроса и Telegram.
// Тело: { action: "join" | "leave", conversation_id } или { action: "reply", conversation_id, text }.

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
const ERROR_STATUS = { not_found: 404, handoff_inactive: 409, invalid_text: 400 } as const;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  let body: { action?: unknown; conversation_id?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const conversationId = body.conversation_id;
  if (typeof conversationId !== "string" || !["join", "reply", "leave"].includes(String(body.action))) {
    return json({ error: "bad_request" }, 400);
  }

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

  try {
    const result = body.action === "join"
      ? await joinChat(deps, conversationId)
      : body.action === "leave"
      ? await leaveChat(deps, conversationId)
      : await sendManagerReply(deps, { conversationId, managerId: userData.user.id, text: body.text });
    if (!result.ok) return json({ error: result.error }, ERROR_STATUS[result.error]);
    return json(result);
  } catch (error) {
    console.error("manager-chat: сбой", error);
    return json({ error: "internal" }, 500);
  }
});
