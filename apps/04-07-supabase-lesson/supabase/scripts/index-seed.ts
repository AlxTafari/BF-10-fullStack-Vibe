// Индексация базы знаний после seed (S10 §4.10): данные, залитые мимо админки (db reset, db:seed:remote), без векторов —
// скрипт проходит все рестораны той же логикой, что кнопка «Переиндексировать всё» (services/knowledge.ts reindexAll),
// но напрямую, без Edge Function.
//
// Запуск: pnpm index:seed. Нужны в .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY.
// Индексирует ту БД, на которую смотрит .env. Настоящий Gemini — копейки за прогон; в CI не запускается.
// Exit code 1 — хотя бы один источник с ошибкой (список в выводе); повторный запуск безопасен.
import { createEmbedderFromEnv } from "../functions/_shared/services/ai/llm.ts";
import { reindexAll, type ReindexSummary, type SourceRef } from "../functions/_shared/services/knowledge.ts";
import { createServiceClient } from "../functions/_shared/supabaseClient.ts";

const client = createServiceClient();
const embed = createEmbedderFromEnv();
if (!embed) Deno.exit(1);

const { data: restaurants, error } = await client.from("restaurants").select("id, name").order("created_at");
if (error) throw error;

let failed = 0;
for (const restaurant of restaurants ?? []) {
  const total = { ready: 0, error: 0, skipped: 0, superseded: 0 };
  let cursor: SourceRef | null = null;
  do {
    const portion: ReindexSummary = await reindexAll({ client, embed }, restaurant.id, cursor);
    total.ready += portion.ready;
    total.error += portion.error;
    total.skipped += portion.skipped;
    total.superseded += portion.superseded;
    for (const e of portion.errors) console.error(`  ✗ ${e.source} ${e.id}: ${e.message}`);
    cursor = portion.nextCursor;
  } while (cursor);
  failed += total.error;
  console.log(
    `${restaurant.name}: ready ${total.ready}, error ${total.error}, ` +
      `skipped ${total.skipped} (не опубликованы), superseded ${total.superseded} (правились во время прогона)`,
  );
}

if (failed > 0) {
  console.error(`Ошибок: ${failed}. Повторите pnpm index:seed — готовые источники просто переиндексируются.`);
  Deno.exit(1);
}
