import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "../src/server.js";

/**
 * Точка входа для Vercel (serverless-функция).
 * Fastify не слушает порт — вручную скармливаем ему объекты req/res.
 * Экземпляр создаётся один раз и переиспользуется между вызовами (тёплый старт).
 */
const app = buildApp();
let ready: Promise<unknown> | null = null;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // app.ready() возвращает thenable-инстанс Fastify, а не настоящий Promise —
  // оборачиваем, чтобы держать один await между вызовами функции.
  if (!ready) ready = Promise.resolve(app.ready());
  await ready;
  app.server.emit("request", req, res);
}
