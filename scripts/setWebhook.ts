/**
 * Регистрирует вебхук в Telegram и задаёт secret_token.
 *
 *   WEBHOOK_URL=https://<домен>/webhook npm run set-webhook
 *
 * Нужны переменные: BOT_TOKEN, WEBHOOK_SECRET (из .env), WEBHOOK_URL (аргумент).
 */
const botToken = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;
const secret = process.env.WEBHOOK_SECRET;

if (!botToken || !webhookUrl || !secret) {
  throw new Error("Нужны BOT_TOKEN, WEBHOOK_SECRET и WEBHOOK_URL");
}

const response = await fetch(
  `https://api.telegram.org/bot${botToken}/setWebhook`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
  },
);

console.log(response.status, await response.json());
