import { createServiceClient } from "../_shared/supabaseClient.ts";
import { createTelegramClient } from "../_shared/telegram/client.ts";
import type { TelegramUpdate } from "../_shared/telegram/types.ts";
import { isValidWebhookSecret } from "../_shared/webhookAuth.ts";
import { routeUpdate } from "./router.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!isValidWebhookSecret(req)) {
    return new Response("forbidden", { status: 401 });
  }

  const update = (await req.json()) as TelegramUpdate;

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN не задан");

    const ctx = {
      client: createServiceClient(),
      tg: createTelegramClient(botToken),
      // inline_query не привязан к чату — chatId тут не используется (answerInlineQuery без chat_id).
      chatId: update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? 0,
    };
    await routeUpdate(ctx, update);
  } catch (error) {
    console.error("telegram-webhook error:", error);
  }

  // Telegram ждёт быстрый 200 и ретраит при ошибке — подтверждаем получение в любом случае.
  return new Response("ok");
});
