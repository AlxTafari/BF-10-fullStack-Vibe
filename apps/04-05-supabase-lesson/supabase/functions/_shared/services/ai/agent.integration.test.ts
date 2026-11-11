// Агент с фейковым LLM против БД с seed (S09): без сети к Gemini, ответы модели заданы заранее.
// Запуск: deno test --allow-env --allow-net --allow-read --env-file=../../.env _shared/services/ai/agent.integration.test.ts
// Без SUPABASE_URL тесты пропускаются (в CI их гоняет job integration). Каждый тест — свой диалог, удаляется в конце.
import { assert, assertEquals } from "@std/assert";
import { type AiSettings, DEFAULT_AI_SETTINGS } from "../../domain/aiSettings.ts";
import { answer, call, createFakeLlm, type FakeLlmStep, say } from "../../llm/fakeLlm.ts";
import type { LlmMessage, LlmRequest } from "../../llm/types.ts";
import { upsertConversation } from "../../repositories/conversationsRepo.ts";
import { getRestaurant } from "../../repositories/restaurantsRepo.ts";
import { createServiceClient } from "../../supabaseClient.ts";
import type { ConversationRow } from "../../types.ts";
import { recordMessage } from "../conversations.ts";
import { MAX_TOOL_ROUNDS, runAgentTurn } from "./agent.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

/** Пометка прошлого ответа агента для истории лимита: расход не важен, важно ai = true. */
const PAST_AI_REPLY = { ai: true, model: "m", tools: [], calls: 1, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, ms: 0 } as const;

// Блюда seed.sql: «Креветки саганаки» в стоп-листе, «Рыба дня» не опубликована.
const STOP_LIST_DISH = "Креветки саганаки";
const HIDDEN_DISH = "Рыба дня";

/** Тест с собственным диалогом гостя: история задаётся репликами, диалог удаляется в конце. */
function agentTest(name: string, fn: (ctx: { conversation: ConversationRow; say: (text: string) => Promise<void> }) => Promise<void>) {
  Deno.test({
    name: `агент: ${name}`,
    ignore: !enabled,
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const client = createServiceClient();
      const restaurant = await getRestaurant(client);
      assert(restaurant, "в БД нет ресторана — запусти seed");
      const conversation = await upsertConversation(client, {
        restaurantId: restaurant.id,
        externalUserId: -Math.floor(Math.random() * 1_000_000_000) - 1,
        chatId: -1,
        displayName: "agent-test",
      });
      try {
        await fn({ conversation, say: (text) => recordMessage(client, conversation.id, "in", text) });
      } finally {
        await client.from("conversations").delete().eq("id", conversation.id);
      }
    },
  });
}

const run = (conversation: ConversationRow, steps: FakeLlmStep[], settings: AiSettings = DEFAULT_AI_SETTINGS) => {
  const llm = createFakeLlm(steps);
  return { llm, result: runAgentTurn({ client: createServiceClient(), llm }, { conversation, settings }) };
};

/** Результат tool из последнего сообщения role = tool в запросе. */
function lastToolResult(request: LlmRequest): Record<string, unknown> {
  const tool = [...request.messages].reverse().find((m): m is Extract<LlmMessage, { role: "tool" }> => m.role === "tool");
  assert(tool, "в запросе нет результата tool");
  return tool.results[0].result;
}

agentTest("ответ по данным tool, результат tool уходит модели", async ({ conversation, say: guest }) => {
  await guest("что есть без молока?");
  let seen: Record<string, unknown> = {};
  const { llm, result } = run(conversation, [
    call("filterMenuByAllergens", { allergens: ["milk"] }),
    (request) => {
      seen = lastToolResult(request);
      return answer("Без молока: дорада, осьминог.");
    },
  ]);
  const turn = await result;
  assertEquals(turn.kind, "reply");
  assert(turn.kind === "reply");
  assertEquals(turn.text, "Без молока: дорада, осьминог.");
  assertEquals(turn.tools, ["filterMenuByAllergens"]);
  assertEquals(turn.model, "fake-model");
  assertEquals(llm.remaining(), 0);

  const names = (group: unknown) => (group as { name: string }[]).map((d) => d.name);
  assert(names(seen.free).includes("Дорада на гриле"));
  assert(names(seen.contains).includes("Дзадзики"));
  // Стоп-лист и неопубликованное не попадают ни в одну группу.
  const all = [...names(seen.free), ...names(seen.contains), ...names(seen.notSpecified)];
  assert(!all.includes(STOP_LIST_DISH), "блюдо из стоп-листа ушло модели");
  assert(!all.includes(HIDDEN_DISH), "неопубликованное блюдо ушло модели");
});

agentTest("контекст: системный промпт, история без кнопок, последняя реплика гостя", async ({ conversation, say: guest }) => {
  const client = createServiceClient();
  await guest("привет");
  await recordMessage(client, conversation.id, "out", "Здравствуйте!");
  await recordMessage(client, conversation.id, "in", "[кнопка] menu:menu", "button");
  await guest("че есть горячего?");
  const { llm, result } = run(conversation, [answer("Дорада на гриле и осьминог.")]);
  await result;
  const request = llm.requests[0];
  assert(request.system.includes("Ресторан Лавраки"));
  assertEquals(request.messages, [
    { role: "user", text: "привет" },
    { role: "model", text: "Здравствуйте!" },
    { role: "user", text: "че есть горячего?" },
  ]);
  assert(request.tools.some((t) => t.name === "filterMenuByAllergens"));
});

agentTest("окно истории: модель видит только последние N сообщений", async ({ conversation, say: guest }) => {
  for (let i = 1; i <= 6; i++) await guest(`вопрос ${i}`);
  const { llm, result } = run(conversation, [answer("ок")], { ...DEFAULT_AI_SETTINGS, historyWindow: 4 });
  await result;
  // Шесть реплик гостя подряд склеены в одну; в окно попали только последние четыре.
  assertEquals(llm.requests[0].messages, [{ role: "user", text: "вопрос 3\nвопрос 4\nвопрос 5\nвопрос 6" }]);
});

agentTest("стоп-лист: карточка блюда для AI — как отсутствующее", async ({ conversation, say: guest }) => {
  const client = createServiceClient();
  const { data } = await client.from("menu_items").select("id").eq("name", STOP_LIST_DISH).single();
  await guest("расскажи про креветки");
  let seen: Record<string, unknown> = {};
  const { result } = run(conversation, [
    call("getDishDetails", { dishId: data!.id }),
    (request) => {
      seen = lastToolResult(request);
      return answer("Сейчас креветок нет.");
    },
  ]);
  await result;
  assertEquals(seen, { error: "not_found" });
});

agentTest("кнопки: только из набора и только на доступное блюдо", async ({ conversation, say: guest }) => {
  const client = createServiceClient();
  const { data: dorada } = await client.from("menu_items").select("id").eq("name", "Дорада на гриле").single();
  const { data: shrimp } = await client.from("menu_items").select("id").eq("name", STOP_LIST_DISH).single();
  await guest("что посоветуете?");
  const { result } = run(conversation, [
    answer("Советую дораду.", [{ kind: "dish", dishId: shrimp!.id }, { kind: "dish", dishId: dorada!.id }, { kind: "hack" }, { kind: "booking" }]),
  ]);
  const turn = await result;
  assert(turn.kind === "reply");
  assertEquals(turn.suggestions, [{ kind: "dish", dishId: dorada!.id, name: "Дорада на гриле" }, { kind: "booking" }]);
});

agentTest("негодные аргументы tool — ошибка модели, не падение хода", async ({ conversation, say: guest }) => {
  await guest("есть что без аллергенов?");
  let seen: Record<string, unknown> = {};
  const { result } = run(conversation, [
    call("filterMenuByAllergens", { allergens: ["орехи", 42] }),
    (request) => {
      seen = lastToolResult(request);
      return call("dropTables", {});
    },
    (request) => {
      assertEquals(lastToolResult(request), { error: "unknown_tool" });
      return answer("Уточните, пожалуйста, какой аллерген.");
    },
  ]);
  const turn = await result;
  assertEquals(seen.error, "invalid_arguments");
  assertEquals(turn.kind, "reply");
});

agentTest("суточный лимит: исчерпан — модель не вызывается", async ({ conversation, say: guest }) => {
  const client = createServiceClient();
  for (let i = 0; i < 5; i++) {
    await recordMessage(client, conversation.id, "out", `ответ ${i}`, "text", { ...PAST_AI_REPLY, tools: [] });
  }
  // Запасные ответы ходами не считаются.
  await recordMessage(client, conversation.id, "out", "запасной", "text", { aiFallback: "error" });
  await guest("ещё вопрос");
  const { llm, result } = run(conversation, [answer("не должно дойти")], { ...DEFAULT_AI_SETTINGS, dailyTurnLimit: 5 });
  assertEquals(await result, { kind: "fallback", reason: "limit", draft: null });
  assertEquals(llm.requests.length, 0);
});

agentTest("лимит не исчерпан, пока запасные ответы не в счёт", async ({ conversation, say: guest }) => {
  const client = createServiceClient();
  for (let i = 0; i < 4; i++) {
    await recordMessage(client, conversation.id, "out", `ответ ${i}`, "text", { ...PAST_AI_REPLY, tools: [] });
  }
  await recordMessage(client, conversation.id, "out", "запасной", "text", { aiFallback: "quota" });
  await guest("ещё вопрос");
  const { result } = run(conversation, [answer("ответ")], { ...DEFAULT_AI_SETTINGS, dailyTurnLimit: 5 });
  assertEquals((await result).kind, "reply");
});

agentTest("ошибки LLM → запасной ответ с причиной", async ({ conversation, say: guest }) => {
  await guest("вопрос");
  assertEquals(await run(conversation, [{ error: "quota" }]).result, { kind: "fallback", reason: "quota", draft: null });
  assertEquals(await run(conversation, [{ error: "timeout" }]).result, { kind: "fallback", reason: "timeout", draft: null });
  assertEquals(await run(conversation, [{ error: "unavailable" }]).result, { kind: "fallback", reason: "error", draft: null });
  // Модель успела ответить раз (listFaq) — расход этого вызова сохраняется в запасном ответе.
  const partial = await run(conversation, [call("listFaq"), { error: "bad_response" }]).result;
  assert(partial.kind === "fallback");
  assertEquals(partial.reason, "error");
  assertEquals(partial.usage?.calls, 1);
});

agentTest("зацикливание: модель не отвечает и на последнем раунде — запасной ответ", async ({ conversation, say: guest }) => {
  await guest("вопрос");
  const steps = Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => call("listFaq"));
  const { llm, result } = run(conversation, steps);
  const turn = await result;
  assert(turn.kind === "fallback");
  assertEquals(turn.reason, "error");
  assertEquals(llm.requests.length, MAX_TOOL_ROUNDS + 1);
});

agentTest("нет ключа Gemini — запасной ответ", async ({ conversation, say: guest }) => {
  await guest("вопрос");
  const turn = await runAgentTurn({ client: createServiceClient(), llm: null }, { conversation, settings: DEFAULT_AI_SETTINGS });
  assertEquals(turn, { kind: "fallback", reason: "error", draft: null });
});

agentTest("расход хода: токены суммируются по всем вызовам модели", async ({ conversation, say: guest }) => {
  await guest("что есть из рыбы?");
  const { result } = run(conversation, [
    { ...call("listMenuCategories"), usage: { input: 1000, output: 20, thoughts: 100 } },
    { ...answer("Дорада и осьминог."), usage: { input: 1500, output: 40, thoughts: 50 } },
  ]);
  const turn = await result;
  assert(turn.kind === "reply");
  assertEquals(
    { ...turn.usage, ms: 0 },
    { calls: 2, inputTokens: 2500, outputTokens: 60, thoughtTokens: 150, ms: 0 },
  );
  assert(turn.usage.ms >= 0);
});

agentTest("reply: ответ только вызовом tool, текст и кнопки одним действием", async ({ conversation, say: guest }) => {
  await guest("хочу забронировать стол");
  const { llm, result } = run(conversation, [answer("Нажмите кнопку ниже.", [{ kind: "booking" }])]);
  const turn = await result;
  assert(turn.kind === "reply");
  assertEquals(turn.suggestions, [{ kind: "booking" }]);
  // Один вызов модели на ход: кнопки не стоят отдельного раунда. reply — не данные, в tools не пишется.
  assertEquals(turn.usage.calls, 1);
  assertEquals(turn.tools, []);
  assertEquals(llm.requests[0].requireToolCall, true);
  assertEquals(llm.requests[0].allowedTools, undefined);
});

agentTest("reply вместе с поиском отклоняется: ответ не пишется до результатов", async ({ conversation, say: guest }) => {
  await guest("есть дорада?");
  let rejected: unknown;
  const { result } = run(conversation, [
    {
      kind: "tool_calls",
      calls: [{ name: "searchMenu", args: { query: "дорада" } }, { name: "reply", args: { text: "Дорады нет.", actions: [] } }],
    },
    (request) => {
      const tool = [...request.messages].reverse().find((m): m is Extract<LlmMessage, { role: "tool" }> => m.role === "tool");
      rejected = tool?.results.find((r) => r.name === "reply")?.result;
      return answer("Есть дорада на гриле, 24 €.");
    },
  ]);
  const turn = await result;
  assert(turn.kind === "reply");
  assertEquals(turn.text, "Есть дорада на гриле, 24 €.");
  assertEquals((rejected as { error: string }).error, "reply_ignored");
});

agentTest("reply с пустым текстом — модель отвечает снова, гость не получает пустое сообщение", async ({ conversation, say: guest }) => {
  await guest("привет");
  const { llm, result } = run(conversation, [answer("   "), answer("Здравствуйте!")]);
  const turn = await result;
  assert(turn.kind === "reply");
  assertEquals(turn.text, "Здравствуйте!");
  assertEquals(llm.requests.length, 2);
});

agentTest("последний раунд: разрешён только reply", async ({ conversation, say: guest }) => {
  await guest("вопрос");
  const steps: FakeLlmStep[] = Array.from({ length: MAX_TOOL_ROUNDS }, () => call("listFaq"));
  steps.push((request) => {
    assertEquals(request.allowedTools, ["reply"]);
    return answer("Вот что нашёл.");
  });
  const { llm, result } = run(conversation, steps);
  assertEquals((await result).kind, "reply");
  assertEquals(llm.requests.length, MAX_TOOL_ROUNDS + 1);
});

agentTest("простой текст вопреки requireToolCall — ответ без кнопок, не сбой", async ({ conversation, say: guest }) => {
  await guest("привет");
  const turn = await run(conversation, [say("Здравствуйте!")]).result;
  assert(turn.kind === "reply");
  assertEquals(turn.suggestions, []);
});

agentTest("draftBooking (сессия 3): черновик в conversations.state, заявки нет, ошибки полей уходят модели", async ({ conversation, say: guest }) => {
  await guest("стол на вчера на четверых, я Анна");
  let seen: Record<string, unknown> = {};
  const { result } = run(conversation, [
    // Вчерашняя дата — ошибка поля; гости и имя принимаются.
    call("draftBooking", { date: "2000-01-01", guests: 4, name: "Анна" }),
    (request) => {
      seen = lastToolResult(request);
      return answer("На вчера уже нельзя. На какую дату?");
    },
  ]);
  const turn = await result;
  assert(turn.kind === "reply");
  assertEquals(turn.tools, ["draftBooking"]);
  assertEquals(seen.errors, { date: "date_in_past" });
  assertEquals(seen.accepted, ["guests", "name"]);
  assertEquals(seen.ready, false);

  // Результат хода несёт шаг черновика — обработчик покажет под ответом кнопки дат.
  assertEquals(turn.draft?.state.step, "date");
  assert(["ask_date", "no_dates"].includes(turn.draft?.reply.screen.screen ?? ""));

  const client = createServiceClient();
  const { data: conv } = await client.from("conversations").select("state").eq("id", conversation.id).single();
  const state = conv!.state as { flow: string; data: Record<string, unknown> };
  assertEquals(state.flow, "booking");
  assertEquals({ guests: state.data.guests, name: state.data.name }, { guests: 4, name: "Анна" });
  const { data: bookings } = await client.from("booking_requests").select("id").eq("conversation_id", conversation.id);
  assertEquals(bookings, []);
});

agentTest("flagThreat: пометка ставится один раз, первая причина остаётся; пустая причина отклоняется", async ({ conversation, say: guest }) => {
  const client = createServiceClient();
  const flagOf = async () =>
    (await client.from("conversations").select("flagged_at, flag_reason").eq("id", conversation.id).single()).data;

  await guest("я приду и разнесу ваш зал");
  let invalidResult: Record<string, unknown> = {};
  const first = await run(conversation, [
    call("flagThreat", { reason: "  " }),
    (request) => {
      invalidResult = lastToolResult(request);
      return call("flagThreat", { reason: "Гость угрожает разгромить зал" });
    },
    answer("Мне жаль, что вы расстроены. Чем могу помочь?"),
  ]).result;
  assertEquals(invalidResult.error, "invalid_arguments");
  assert(first.kind === "reply");
  assertEquals(first.tools, ["flagThreat", "flagThreat"]);
  const flag = await flagOf();
  assert(flag?.flagged_at, "пометка не поставлена");
  assertEquals(flag.flag_reason, "Гость угрожает разгромить зал");

  await guest("и персоналу достанется");
  let second: Record<string, unknown> = {};
  await run(conversation, [
    call("flagThreat", { reason: "Угроза персоналу" }),
    (request) => {
      second = lastToolResult(request);
      return answer("Давайте спокойно разберёмся.");
    },
  ]).result;
  assertEquals(second, { flagged: true, alreadyFlagged: true });
  assertEquals((await flagOf())?.flag_reason, "Гость угрожает разгромить зал");
});
