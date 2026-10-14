import { isValidNotifySecret } from "../_shared/notifyAuth.ts";
import { notifyGuestOfBookingDecision } from "../_shared/services/guestNotification.ts";
import { createServiceClient } from "../_shared/supabaseClient.ts";
import { createTelegramClient } from "../_shared/telegram/client.ts";

// Вызывается триггером БД после решения менеджера по брони (миграция request_status_rpc).
// Тело: { booking_id, status }. Всегда отвечает 200 после проверки секрета: pg_net не ретраит,
// а исход виден в booking_requests.guest_notified_at.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!isValidNotifySecret(req)) return new Response("forbidden", { status: 401 });

  let body: { booking_id?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (typeof body.booking_id !== "string" || typeof body.status !== "string") {
    return new Response("bad request", { status: 400 });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    console.error("notify-guest: TELEGRAM_BOT_TOKEN не задан");
    return Response.json({ result: "failed" });
  }
  const tg = createTelegramClient(botToken);
  const result = await notifyGuestOfBookingDecision(
    createServiceClient(),
    (chatId, text) => tg.sendMessage(chatId, text),
    body.booking_id,
    body.status,
  );
  return Response.json({ result });
});
