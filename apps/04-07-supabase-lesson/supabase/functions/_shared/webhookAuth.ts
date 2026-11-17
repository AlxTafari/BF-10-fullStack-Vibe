export function isValidWebhookSecret(req: Request): boolean {
  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!expected) return false;
  const received = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  return received === expected;
}
