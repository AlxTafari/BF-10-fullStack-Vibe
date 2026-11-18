// Бюджет и сбои поиска по базе знаний (S10, сессия 3) без БД: во всех кейсах до match_knowledge дело не доходит,
// поэтому клиент — пустая заглушка. Поиск по настоящей БД — knowledgeSearch.integration.test.ts.
import { assert, assertEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Embedder, LlmError } from "../llm/types.ts";
import { ANSWER_RESERVE_MS, MIN_SEARCH_MS, searchKnowledge, SEARCH_TIMEOUT_MS } from "./knowledgeSearch.ts";

// Обращение к клиенту в этих тестах — уже ошибка: значит, поиск пошёл в БД, хотя не должен был.
const noDb = new Proxy({}, {
  get() {
    throw new Error("тест не должен ходить в БД");
  },
}) as SupabaseClient;

const input = (deadline: number) => ({ restaurantId: "00000000-0000-0000-0000-000000000000", query: "что-нибудь лёгкое", deadline });

Deno.test("searchKnowledge: нет эмбеддера — unavailable", async () => {
  assertEquals(await searchKnowledge({ client: noDb, embed: null }, input(Date.now() + 60_000)), { ok: false, reason: "unavailable" });
});

Deno.test("searchKnowledge: времени до конца хода меньше резерва и минимума — запрос не начинается", async () => {
  let called = false;
  // deno-lint-ignore require-await
  const embed: Embedder = async () => {
    called = true;
    return [];
  };
  const now = () => 1_000_000;
  const deadline = now() + ANSWER_RESERVE_MS + MIN_SEARCH_MS - 1;
  assertEquals(await searchKnowledge({ client: noDb, embed, now }, input(deadline)), { ok: false, reason: "no_time" });
  assertEquals(called, false);
});

Deno.test("searchKnowledge: бюджет — не больше SEARCH_TIMEOUT_MS и не позже резерва на ответ", async () => {
  const seen: number[] = [];
  const embed: Embedder = (_texts, _task, options) => {
    seen.push(options.timeoutMs);
    return Promise.reject(new LlmError("unavailable", "fake"));
  };
  const now = () => 1_000_000;
  await searchKnowledge({ client: noDb, embed, now }, input(now() + 60_000));
  await searchKnowledge({ client: noDb, embed, now }, input(now() + ANSWER_RESERVE_MS + 2_000));
  assertEquals(seen, [SEARCH_TIMEOUT_MS, 2_000]);
});

Deno.test("searchKnowledge: сбой эмбеддинга — unavailable, таймаут провайдера — timeout", async () => {
  const failing = (kind: LlmError["kind"]): Embedder => () => Promise.reject(new LlmError(kind, "fake"));
  const deadline = Date.now() + 60_000;
  assertEquals(await searchKnowledge({ client: noDb, embed: failing("quota") }, input(deadline)), { ok: false, reason: "unavailable" });
  assertEquals(await searchKnowledge({ client: noDb, embed: failing("timeout") }, input(deadline)), { ok: false, reason: "timeout" });
  const broken: Embedder = () => Promise.reject(new TypeError("boom"));
  assertEquals(await searchKnowledge({ client: noDb, embed: broken }, input(deadline)), { ok: false, reason: "unavailable" });
});

Deno.test("searchKnowledge: зависший эмбеддинг не держит ход дольше бюджета", async () => {
  // Провайдер игнорирует таймаут и не отвечает никогда: сервис обязан вернуться сам.
  const hanging: Embedder = () => new Promise(() => {});
  const budget = 1_200;
  const started = Date.now();
  const result = await searchKnowledge({ client: noDb, embed: hanging }, input(started + ANSWER_RESERVE_MS + budget));
  const elapsed = Date.now() - started;
  assertEquals(result, { ok: false, reason: "timeout" });
  assert(elapsed >= budget - 50 && elapsed < budget + 500, `поиск занял ${elapsed} мс при бюджете ${budget}`);
});
