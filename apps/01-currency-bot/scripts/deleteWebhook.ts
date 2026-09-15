/**
 * Снимает вебхук (например, чтобы временно отлаживать бота локально).
 *   npm run delete-webhook
 */
const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  throw new Error("Нужен BOT_TOKEN");
}

const response = await fetch(
  `https://api.telegram.org/bot${botToken}/deleteWebhook`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ drop_pending_updates: false }),
  },
);

console.log(response.status, await response.json());
