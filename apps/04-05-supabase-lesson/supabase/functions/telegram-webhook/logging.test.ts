// Тесты replyNav / replyFaqAnswer с подменёнными Telegram-клиентом и Supabase (rpc + from).
import { assertEquals } from "jsr:@std/assert@1";
import { TelegramApiError } from "../_shared/telegram/client.ts";
import type { HandlerContext } from "./context.ts";
import { replyFaqAnswer, replyNav } from "./logging.ts";

const NOW = Date.now();
const iso = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
const err = (code: number, description: string) => new TelegramApiError("x", code, description);

interface Setup {
  lastNav?: unknown;
  callbackMessageId?: number | null;
  isPrivate?: boolean;
  /** Ошибка / поведение Telegram по методам. */
  editError?: Error;
  deleteError?: Error;
  clearError?: Error;
  /** Ответ set_last_nav (по очереди; по умолчанию true). */
  navCas?: boolean[];
  /** Ответы set_faq_answer по очереди. */
  faqCas?: { swapped: boolean; previous_id: number | null }[];
  /** Что вернёт перечитывание last_nav после проигранного CAS. */
  reloaded?: unknown;
  rpcError?: boolean;
}

function setup(o: Setup = {}) {
  const calls: string[] = [];
  const journal: string[] = [];
  const nav = [...(o.navCas ?? [])];
  const faq = [...(o.faqCas ?? [])];
  let nextId = 500;
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push(`rpc:${name}:${JSON.stringify(args)}`);
      if (o.rpcError) return Promise.resolve({ data: null, error: new Error("db") });
      if (name === "set_last_nav") return Promise.resolve({ data: nav.length ? nav.shift() : true, error: null });
      return Promise.resolve({ data: [faq.length ? faq.shift() : { swapped: true, previous_id: null }], error: null });
    },
    from(table: string) {
      if (table === "messages") {
        return { insert: (row: { text: string }) => (journal.push(row.text), Promise.resolve({ error: null })) };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: { last_nav: o.reloaded ?? null }, error: null }) }),
        }),
      };
    },
  };
  const tg = {
    sendMessage: (_c: number, text: string) => (calls.push(`send:${text}`), Promise.resolve(nextId++)),
    editMessageText: (_c: number, id: number, text: string) => {
      calls.push(`edit:${id}:${text}`);
      return o.editError ? Promise.reject(o.editError) : Promise.resolve();
    },
    deleteMessage: (_c: number, id: number) => {
      calls.push(`delete:${id}`);
      return o.deleteError ? Promise.reject(o.deleteError) : Promise.resolve();
    },
    clearKeyboard: (_c: number, id: number) => {
      calls.push(`clear:${id}`);
      return o.clearError ? Promise.reject(o.clearError) : Promise.resolve();
    },
  };
  const ctx = {
    client,
    tg,
    chatId: 1,
    username: null,
    isPrivate: o.isPrivate ?? true,
    callbackMessageId: o.callbackMessageId ?? null,
    conversation: { id: "c1", last_nav: o.lastNav ?? null },
  } as unknown as HandlerContext;
  return { ctx, calls, journal };
}

const navOf = (screen: string, message_id: number, secondsAgo = 10, extra: object = {}) => ({
  screen,
  message_id,
  at: iso(secondsAgo),
  ...extra,
});
const rpcOnly = (calls: string[], name: string) => calls.filter((c) => c.startsWith(`rpc:${name}`));

Deno.test("replyNav: первый показ — send, запоминаем, ничего не удаляем", async () => {
  const { ctx, calls, journal } = setup();
  await replyNav(ctx, "menu", "Меню");
  assertEquals(calls.filter((c) => !c.startsWith("rpc")), ["send:Меню"]);
  assertEquals(rpcOnly(calls, "set_last_nav").length, 1);
  assertEquals(journal, ["Меню"]);
});

Deno.test("replyNav: дубль в окне — send, затем удаление предыдущего", async () => {
  const { ctx, calls, journal } = setup({ lastNav: navOf("menu", 100) });
  await replyNav(ctx, "menu", "Меню");
  assertEquals(calls.filter((c) => !c.startsWith("rpc")), ["send:Меню", "delete:100"]);
  assertEquals(journal, ["Меню"]); // дубль в журнале остаётся
});

Deno.test("replyNav: другой экран — ничего не удаляется", async () => {
  const { ctx, calls } = setup({ lastNav: navOf("menu", 100) });
  await replyNav(ctx, "info", "Инфо");
  assertEquals(calls.filter((c) => c.startsWith("delete")), []);
});

Deno.test("replyNav: edit в «Меню блюд» на последнем сообщении", async () => {
  const { ctx, calls, journal } = setup({ lastNav: navOf("cats", 100), callbackMessageId: 100 });
  await replyNav(ctx, "cat:1", "Блюда");
  assertEquals(calls.filter((c) => !c.startsWith("rpc")), ["edit:100:Блюда"]);
  assertEquals(journal, ["Блюда"]);
});

Deno.test("replyNav: «message is not modified» — успех без записи в журнал и без отправки", async () => {
  const { ctx, calls, journal } = setup({
    lastNav: navOf("cats", 100),
    callbackMessageId: 100,
    editError: err(400, "Bad Request: message is not modified: specified new message content..."),
  });
  await replyNav(ctx, "cats", "Категории");
  assertEquals(calls.filter((c) => c.startsWith("send")), []);
  assertEquals(journal, []);
});

Deno.test("replyNav: «message to edit not found» — fallback на send, журнал пишется", async () => {
  const { ctx, calls, journal } = setup({
    lastNav: navOf("cats", 100),
    callbackMessageId: 100,
    editError: err(400, "Bad Request: message to edit not found"),
  });
  await replyNav(ctx, "cat:1", "Блюда");
  assertEquals(calls.filter((c) => !c.startsWith("rpc")), ["edit:100:Блюда", "send:Блюда"]);
  assertEquals(journal, ["Блюда"]);
});

Deno.test("replyNav: «message can't be edited» — тоже fallback на send", async () => {
  const { ctx, calls } = setup({
    lastNav: navOf("cats", 100),
    callbackMessageId: 100,
    editError: err(400, "Bad Request: message can't be edited"),
  });
  await replyNav(ctx, "cat:1", "Блюда");
  assertEquals(calls.some((c) => c === "send:Блюда"), true);
});

Deno.test("replyNav: незнакомая ошибка edit — throw", async () => {
  const { ctx } = setup({ lastNav: navOf("cats", 100), callbackMessageId: 100, editError: err(500, "boom") });
  let thrown = false;
  try {
    await replyNav(ctx, "cat:1", "Блюда");
  } catch {
    thrown = true;
  }
  assertEquals(thrown, true);
});

Deno.test("replyNav: кнопка на старом сообщении «Меню блюд» — send, старое не правится", async () => {
  const { ctx, calls } = setup({ lastNav: navOf("cats", 100), callbackMessageId: 55 });
  await replyNav(ctx, "cat:1", "Блюда");
  assertEquals(calls.filter((c) => c.startsWith("edit")), []);
  assertEquals(calls.some((c) => c === "send:Блюда"), true);
});

Deno.test("replyNav: CAS проигран, победитель — тот же экран → удаляем свою отправку", async () => {
  const { ctx, calls, journal } = setup({
    lastNav: navOf("info", 100),
    navCas: [false],
    reloaded: navOf("menu", 777, 0),
  });
  await replyNav(ctx, "menu", "Меню");
  // Своё сообщение (500) убираем, в чате остаётся сообщение победителя (777); в журнале ответ остаётся.
  assertEquals(calls.filter((c) => c.startsWith("delete")), ["delete:500"]);
  assertEquals(journal, ["Меню"]);
});

Deno.test("replyNav: CAS проигран, победитель — другой экран → оставляем", async () => {
  const { ctx, calls } = setup({ lastNav: navOf("menu", 100), navCas: [false], reloaded: navOf("faq-ish", 777, 0) });
  await replyNav(ctx, "info", "Инфо");
  assertEquals(calls.filter((c) => c.startsWith("delete")), []);
});

Deno.test("replyNav: ошибка удаления проглочена, ответ записан", async () => {
  const { ctx, journal } = setup({ lastNav: navOf("menu", 100), deleteError: err(400, "message can't be deleted") });
  await replyNav(ctx, "menu", "Меню");
  assertEquals(journal, ["Меню"]);
});

Deno.test("replyNav: ошибка записи last_nav — деградация, не отказ", async () => {
  const { ctx, calls, journal } = setup({ lastNav: navOf("menu", 100), rpcError: true });
  await replyNav(ctx, "menu", "Меню");
  assertEquals(calls.filter((c) => c.startsWith("delete")), []);
  assertEquals(journal, ["Меню"]);
});

Deno.test("replyNav: группа — как обычный reply, без rpc и удалений", async () => {
  const { ctx, calls } = setup({ isPrivate: false, lastNav: navOf("menu", 100) });
  await replyNav(ctx, "menu", "Меню");
  assertEquals(calls, ["send:Меню"]);
});

Deno.test("replyFaqAnswer: первый ответ — ничего не снимаем", async () => {
  const { ctx, calls, journal } = setup();
  await replyFaqAnswer(ctx, "Ответ", []);
  assertEquals(calls.filter((c) => c.startsWith("clear")), []);
  assertEquals(journal, ["Ответ"]);
});

Deno.test("replyFaqAnswer: второй ответ — снимаем клавиатуру у первого, expected = прежний id", async () => {
  const { ctx, calls } = setup({
    lastNav: { faq_answer_id: 300 },
    faqCas: [{ swapped: true, previous_id: 300 }],
  });
  await replyFaqAnswer(ctx, "Ответ 2", []);
  assertEquals(calls.filter((c) => c.startsWith("clear")), ["clear:300"]);
  assertEquals(rpcOnly(calls, "set_faq_answer")[0].includes('"p_expected":300'), true);
});

Deno.test("replyFaqAnswer: ошибка снятия клавиатуры проглочена", async () => {
  const { ctx, journal } = setup({
    lastNav: { faq_answer_id: 300 },
    faqCas: [{ swapped: true, previous_id: 300 }],
    clearError: err(400, "message to edit not found"),
  });
  await replyFaqAnswer(ctx, "Ответ 2", []);
  assertEquals(journal, ["Ответ 2"]);
});

Deno.test("replyFaqAnswer: CAS проигран — повтор от актуального значения, снимаем у обоих предыдущих", async () => {
  const { ctx, calls } = setup({
    lastNav: { faq_answer_id: 300 },
    faqCas: [{ swapped: false, previous_id: 400 }, { swapped: true, previous_id: 400 }],
  });
  await replyFaqAnswer(ctx, "Ответ 3", []);
  assertEquals(rpcOnly(calls, "set_faq_answer").length, 2);
  assertEquals(calls.filter((c) => c.startsWith("clear")), ["clear:400"]);
});

Deno.test("replyFaqAnswer: ошибка БД — ответ ушёл, кнопки у старого остаются", async () => {
  const { ctx, calls, journal } = setup({ lastNav: { faq_answer_id: 300 }, rpcError: true });
  await replyFaqAnswer(ctx, "Ответ 2", []);
  assertEquals(calls.filter((c) => c.startsWith("clear")), []);
  assertEquals(journal, ["Ответ 2"]);
});

Deno.test("replyFaqAnswer: группа — обычный reply", async () => {
  const { ctx, calls } = setup({ isPrivate: false });
  await replyFaqAnswer(ctx, "Ответ", []);
  assertEquals(calls, ["send:Ответ"]);
});
