import { createClient } from "@supabase/supabase-js";
import { createEmbedderFromEnv } from "../_shared/services/ai/llm.ts";
import {
  indexSource,
  type KnowledgeSource,
  managerCanIndexSource,
  managerOfRestaurant,
  reindexAll,
  type SourceRef,
} from "../_shared/services/knowledge.ts";
import { createServiceClient } from "../_shared/supabaseClient.ts";

// Индексация базы знаний (S10, сессия 2). Вызывает админка (supabase.functions.invoke) после сохранения документа
// или блюда, по кнопке «Повторить» и порциями по «Переиндексировать всё».
// verify_jwt = true: без токена шлюз не пропустит. Доступ проверяется запросом с JWT менеджера (RLS): источник
// виден — он из его ресторана; ресторан виден — менеджер его. Запись чанков — service role, служебными RPC.
// Тело: { action: "document" | "dish", id } или { action: "all", restaurantId, cursor? }.
// Ответ: { status } для одного источника; сводка порции (ReindexSummary) для all.

// Как в manager-chat: админка на другом домене, авторизация заголовком, поэтому «*» безопасно.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// Невалидный uuid PostgREST отвергает ошибкой 22P02 — ловим раньше и отвечаем 400, а не 500.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isSource = (value: unknown): value is KnowledgeSource => value === "document" || value === "dish";

/** Курсор приходит от клиента обратно как есть — проверяем форму, доверять содержимому не нужно. */
function parseCursor(value: unknown): SourceRef | null | undefined {
  if (value === undefined || value === null) return null;
  const c = value as { source?: unknown; id?: unknown };
  return isSource(c.source) && isUuid(c.id) ? { source: c.source, id: c.id } : undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  let body: { action?: unknown; id?: unknown; restaurantId?: unknown; cursor?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    console.error("knowledge-index: SUPABASE_URL / SUPABASE_ANON_KEY не заданы");
    return json({ error: "misconfigured" }, 500);
  }
  const embed = createEmbedderFromEnv();
  if (!embed) return json({ error: "ai_unavailable" }, 503);

  // Клиент «от имени менеджера»: RLS сама решает, что ему видно.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const deps = { client: createServiceClient(), embed };

  try {
    if (isSource(body.action)) {
      if (!isUuid(body.id)) return json({ error: "bad_request" }, 400);
      if (!(await managerCanIndexSource(userClient, body.action, body.id))) return json({ error: "not_found" }, 404);
      return json(await indexSource(deps, body.action, body.id));
    }
    if (body.action === "all") {
      const cursor = parseCursor(body.cursor);
      if (!isUuid(body.restaurantId) || cursor === undefined) return json({ error: "bad_request" }, 400);
      if (!(await managerOfRestaurant(userClient, body.restaurantId))) return json({ error: "not_found" }, 404);
      return json(await reindexAll(deps, body.restaurantId, cursor));
    }
    return json({ error: "bad_request" }, 400);
  } catch (error) {
    console.error("knowledge-index: сбой", error instanceof Error ? error.message : String(error));
    return json({ error: "internal" }, 500);
  }
});
