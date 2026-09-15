import { buildApp } from "./server.js";

/**
 * Локальный / VPS-запуск: обычный слушающий сервер.
 * На Vercel вместо этого используется api/index.ts.
 */
const app = buildApp();
const port = Number(process.env.PORT ?? "3000");

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
