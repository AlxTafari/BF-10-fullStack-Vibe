// Агент с фейковым LLM против БД с seed (S09): без сети к Gemini, ответы модели заданы заранее.
// Запуск: deno test --allow-env --allow-net --allow-read --env-file=../../.env _shared/services/ai/agent.integration.test.ts
// Без SUPABASE_URL тесты пропускаются (в CI их гоняет job integration). Каждый тест — свой диалог, удаляется в конце.
import { assert, assertEquals } from "@std/assert";
import { type AiSettings, DEFAULT_AI_SETTINGS } from "../../domain/aiSettings.ts";
import { call, createFakeLlm, type FakeLlmStep, say } from "../../llm/fakeLlm.ts";
import type { LlmMessage, LlmRequest } from "../../llm/types.ts";
import { upsertConversation } from "../../repositories/conversationsRepo.ts";
import { getRestaurant } from "../../repositories/restaurantsRepo.ts";
import { createServiceClient } from "../../supabaseClient.ts";
import type { ConversationRow } from "../../types.ts";
import { recordMessage } from "../conversations.ts";
import { MAX_TOOL_ROUNDS, runAgentTurn } from "./agent.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
      return say("Без молока: дорада, осьминог.");
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
  const { llm, result } = run(conversation, [say("Дорада на гриле и осьминог.")]);
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
  const { llm, result } = run(conversation, [say("ок")], { ...DEFAULT_AI_SETTINGS, historyWindow: 4 });
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
      return say("Сейчас креветок нет.");
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
    call("suggestActions", {
      actions: [{ kind: "dish", dishId: shrimp!.id }, { kind: "dish", dishId: dorada!.id }, { kind: "hack" }, { kind: "booking" }],
    }),
    say("Советую дораду."),
  ]);
  const turn = await result;
  assert(turn.kind === "reply");
  assertEquals(turn.suggestions, [{ kind: "dish", dishId: dorada!.id }, { kind: "booking" }]);
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
      return say("Уточните, пожалуйста, какой аллерген.");
    },
  ]);
  const turn = await result;
  assertEquals(seen.error, "invalid_arguments");
  assertEquals(turn.kind, "reply");
});

agentTest("суточный лимит: исчерпан — модель не вызывается", async ({ conversation, say: guest }) => {
  const client = createServiceClient();
  for (let i = 0; i < 5; i++) {
    await recordMessage(client, conversation.id, "out", `ответ ${i}`, "text", { ai: true, model: "m", tools: [] });
  }
  // Запасные ответы ходами не считаются.
  await recordMessage(client, conversation.id, "out", "запасной", "text", { aiFallback: "error" });
  await guest("ещё вопрос");
  const { llm, result } = run(conversation, [say("не должно дойти")], { ...DEFAULT_AI_SETTINGS, dailyTurnLimit: 5 });
  assertEquals(await result, { kind: "fallback", reason: "limit" });
  assertEquals(llm.requests.length, 0);
});

agentTest("лимит не исчерпан, пока запасные ответы не в счёт", async ({ conversation, say: guest }) => {
  const client = createServiceClient();
  for (let i = 0; i < 4; i++) {
    await recordMessage(client, conversation.id, "out", `ответ ${i}`, "text", { ai: true, model: "m", tools: [] });
  }
  await recordMessage(client, conversation.id, "out", "запасной", "text", { aiFallback: "quota" });
  await guest("ещё вопрос");
  const { result } = run(conversation, [say("ответ")], { ...DEFAULT_AI_SETTINGS, dailyTurnLimit: 5 });
  assertEquals((await result).kind, "reply");
});

agentTest("ошибки LLM → запасной ответ с причиной", async ({ conversation, say: guest }) => {
  await guest("вопрос");
  assertEquals(await run(conversation, [{ error: "quota" }]).result, { kind: "fallback", reason: "quota" });
  assertEquals(await run(conversation, [{ error: "timeout" }]).result, { kind: "fallback", reason: "timeout" });
  assertEquals(await run(conversation, [{ error: "unavailable" }]).result, { kind: "fallback", reason: "error" });
  assertEquals(await run(conversation, [call("listFaq"), { error: "bad_response" }]).result, { kind: "fallback", reason: "error" });
});

agentTest("зацикливание на tools обрывается после лимита раундов", async ({ conversation, say: guest }) => {
  await guest("вопрос");
  const steps = Array.from({ length: MAX_TOOL_ROUNDS + 1 }, () => call("listFaq"));
  const { llm, result } = run(conversation, steps);
  assertEquals(await result, { kind: "fallback", reason: "error" });
  assertEquals(llm.requests.length, MAX_TOOL_ROUNDS + 1);
});

agentTest("нет ключа Gemini — запасной ответ", async ({ conversation, say: guest }) => {
  await guest("вопрос");
  const turn = await runAgentTurn({ client: createServiceClient(), llm: null }, { conversation, settings: DEFAULT_AI_SETTINGS });
  assertEquals(turn, { kind: "fallback", reason: "error" });
});
