/**
 * Регистрирует меню команд бота (список слева от поля ввода в Telegram).
 * Разовый запрос, как set-webhook.
 *
 *   npm run set-commands
 *
 * Нужна переменная: BOT_TOKEN (из .env).
 */
const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  throw new Error("Нужен BOT_TOKEN");
}

const commands = [
  { command: "rates", description: "Курсы популярных валют к USD" },
  { command: "source", description: "Текущий источник курсов" },
  { command: "help", description: "Справка и примеры" },
];

const response = await fetch(
  `https://api.telegram.org/bot${botToken}/setMyCommands`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands }),
  },
);

console.log(response.status, await response.json());
