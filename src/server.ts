import Fastify, { type FastifyInstance } from "fastify";
import { mapUpdate } from "./adapters/telegram/mapUpdate.js";
import type { TelegramUpdate } from "./adapters/telegram/telegramTypes.js";
import { handleIncomingMessage } from "./application/useCases/handleIncomingMessage.js";
import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";

/**
 * HTTP-адаптер на Fastify. Держит только транспорт:
 * приём вебхука, проверку секрета, вызов use case'а.
 */
export function buildApp(): FastifyInstance {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const deps = buildContainer(config, (err) => app.log.error(err));

  // Заглушка на корень: без неё Vercel-rewrite ведёт сюда любой GET
  // и Fastify отдаёт 500 (нет роута). Сам эндпоинт ничего не раскрывает.
  app.get("/", async () => ({
    ok: true,
    bot: "currency-converter",
    repo: "https://github.com/AlxTafari/BF-10-WhatsUpCurrency",
  }));

  app.get("/health", async () => ({
    ok: true,
    provider: deps.provider.name,
  }));

  app.post("/webhook", async (request, reply) => {
    // Telegram присылает этот заголовок, если вебхук зарегистрирован с secret_token.
    const secret = request.headers["x-telegram-bot-api-secret-token"];
    if (secret !== config.webhookSecret) {
      return reply.code(401).send({ error: "bad secret" });
    }

    const incoming = mapUpdate(request.body as TelegramUpdate);
    if (incoming) {
      // Работа — пара коротких HTTP-запросов, поэтому дожидаемся её
      // до ответа Telegram. Если появится что-то тяжёлое —
      // отвечать 200 сразу, а обработку выносить в очередь.
      try {
        await handleIncomingMessage(incoming, deps);
      } catch (err) {
        app.log.error(err);
      }
    }

    // Всегда 200: иначе Telegram будет ретраить один и тот же апдейт.
    return { ok: true };
  });

  return app;
}
