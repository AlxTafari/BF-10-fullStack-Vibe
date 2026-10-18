import { assertEquals } from "jsr:@std/assert@1";
import { decideNav, DUPLICATE_WINDOW_SECONDS, type LastNav, parseFaqAnswerId, parseLastNav, sectionOf } from "./navigation.ts";

const NOW = new Date("2026-10-18T10:05:00Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();
const last = (screen: string, seconds = 10, messageId = 100): LastNav => ({ screen, messageId, at: ago(seconds) });

Deno.test("окно дубля — 120 секунд", () => {
  assertEquals(DUPLICATE_WINDOW_SECONDS, 120);
});

Deno.test("тот же экран в окне → send и удаление предыдущего", () => {
  assertEquals(decideNav({ screen: "info", callbackMessageId: 100, last: last("info"), now: NOW }), {
    type: "send",
    deleteId: 100,
  });
});

Deno.test("граница окна: 119 с — дубль, 120 с и 121 с — нет", () => {
  const at = (s: number) => decideNav({ screen: "menu", callbackMessageId: null, last: last("menu", s), now: NOW });
  assertEquals(at(119), { type: "send", deleteId: 100 });
  assertEquals(at(120), { type: "send", deleteId: null });
  assertEquals(at(121), { type: "send", deleteId: null });
});

Deno.test("метка из будущего (сдвиг часов) — не дубль, ничего не удаляем", () => {
  assertEquals(decideNav({ screen: "menu", callbackMessageId: null, last: last("menu", -30), now: NOW }), {
    type: "send",
    deleteId: null,
  });
});

Deno.test("другой экран или нет last → deleteId = null", () => {
  assertEquals(decideNav({ screen: "info", callbackMessageId: null, last: last("menu"), now: NOW }), {
    type: "send",
    deleteId: null,
  });
  assertEquals(decideNav({ screen: "menu", callbackMessageId: null, last: null, now: NOW }), {
    type: "send",
    deleteId: null,
  });
});

Deno.test("cat:<id> — экран включает id: другая категория не дубль", () => {
  assertEquals(decideNav({ screen: "cat:2", callbackMessageId: 7, last: last("cat:1", 5, 7), now: NOW }), {
    type: "edit",
    messageId: 7,
  });
  assertEquals(decideNav({ screen: "cat:2", callbackMessageId: null, last: last("cat:1"), now: NOW }), {
    type: "send",
    deleteId: null,
  });
});

Deno.test("правка: внутри «Меню блюд» на последнем сообщении → edit", () => {
  assertEquals(decideNav({ screen: "cat:1", callbackMessageId: 100, last: last("cats"), now: NOW }), {
    type: "edit",
    messageId: 100,
  });
  assertEquals(decideNav({ screen: "dish:9", callbackMessageId: 100, last: last("cat:1", 3600), now: NOW }), {
    type: "edit",
    messageId: 100,
  });
});

Deno.test("правка: кнопка на другом (старом) сообщении → send, старое не трогаем", () => {
  assertEquals(decideNav({ screen: "cat:1", callbackMessageId: 55, last: last("cats"), now: NOW }), {
    type: "send",
    deleteId: null,
  });
});

Deno.test("правка: кнопка в последнем сообщении, но другого раздела → send", () => {
  // «Меню блюд» нажато в сообщении главного меню: переходим в новый раздел новым сообщением.
  assertEquals(decideNav({ screen: "cats", callbackMessageId: 100, last: last("menu"), now: NOW }), {
    type: "send",
    deleteId: null,
  });
});

Deno.test("menu и info никогда не edit", () => {
  assertEquals(decideNav({ screen: "menu", callbackMessageId: 100, last: last("menu", 500), now: NOW }).type, "send");
  assertEquals(decideNav({ screen: "info", callbackMessageId: 100, last: last("info", 500), now: NOW }).type, "send");
  assertEquals(decideNav({ screen: "menu", callbackMessageId: 100, last: last("cats", 5), now: NOW }).type, "send");
});

Deno.test("deleteId всегда null вне условия дубля (перебор)", () => {
  const screens = ["menu", "info", "cats", "cat:1", "dish:1"] as const;
  for (const screen of screens) {
    for (const prev of [...screens, "faq"]) {
      for (const s of [5, 119, 120, 500]) {
        const d = decideNav({ screen, callbackMessageId: null, last: last(prev, s), now: NOW });
        const isDuplicate = prev === screen && s < DUPLICATE_WINDOW_SECONDS;
        assertEquals(d.type === "send" && d.deleteId !== null, isDuplicate, `${prev}→${screen} ${s}s`);
      }
    }
  }
});

Deno.test("сценарий: кнопка на последнем сообщении того же черновика → edit", () => {
  assertEquals(decideNav({ screen: "flow:A", callbackMessageId: 100, last: last("flow:A", 3600), now: NOW }), {
    type: "edit",
    messageId: 100,
  });
});

Deno.test("сценарий: текстовый шаг (имя, контакт) → новое сообщение внизу, прежнее удаляем", () => {
  assertEquals(decideNav({ screen: "flow:A", callbackMessageId: null, last: last("flow:A", 3600), now: NOW }), {
    type: "send",
    deleteId: 100,
  });
});

Deno.test("сценарий: итог (redraw) → новое сообщение внизу, сводка удаляется", () => {
  assertEquals(decideNav({ screen: "flow:A", callbackMessageId: 100, last: last("flow:A", 3600), now: NOW, redraw: true }), {
    type: "send",
    deleteId: 100,
  });
  // Сводки нет (другой черновик) — удалять нечего.
  assertEquals(decideNav({ screen: "flow:B", callbackMessageId: 100, last: last("flow:A"), now: NOW, redraw: true }), {
    type: "send",
    deleteId: null,
  });
});

Deno.test("сценарий: другой черновик, чужое сообщение или другой раздел → send без удаления", () => {
  const send = { type: "send", deleteId: null } as const;
  assertEquals(decideNav({ screen: "flow:B", callbackMessageId: null, last: last("flow:A"), now: NOW }), send);
  assertEquals(decideNav({ screen: "flow:A", callbackMessageId: 55, last: last("flow:A"), now: NOW }), send);
  // «Забронировать» нажато в сообщении меню: меню остаётся, сценарий — новым сообщением.
  assertEquals(decideNav({ screen: "flow:A", callbackMessageId: 100, last: last("menu"), now: NOW }), send);
  assertEquals(decideNav({ screen: "flow:A", callbackMessageId: null, last: null, now: NOW }), send);
});

Deno.test("sectionOf", () => {
  assertEquals(sectionOf("flow:abc"), "flow");
  assertEquals(sectionOf("menu"), "menu");
  assertEquals(sectionOf("info"), "info");
  assertEquals(sectionOf("cats"), "dishes");
  assertEquals(sectionOf("cat:1"), "dishes");
  assertEquals(sectionOf("dish:1"), "dishes");
  assertEquals(sectionOf("faq"), null);
});

Deno.test("parseLastNav: валидная запись, мусор и «только faq_answer_id»", () => {
  assertEquals(parseLastNav({ screen: "cats", message_id: 5, at: "2026-10-18T10:00:00Z" }), {
    screen: "cats",
    messageId: 5,
    at: "2026-10-18T10:00:00Z",
  });
  assertEquals(parseLastNav({ faq_answer_id: 9 }), null);
  assertEquals(parseLastNav(null), null);
  assertEquals(parseLastNav("x"), null);
  assertEquals(parseLastNav({ screen: "cats", message_id: "5", at: "2026-10-18T10:00:00Z" }), null);
  assertEquals(parseLastNav({ screen: "cats", message_id: 5, at: "не дата" }), null);
});

Deno.test("parseFaqAnswerId", () => {
  assertEquals(parseFaqAnswerId({ faq_answer_id: 1187, screen: "menu" }), 1187);
  assertEquals(parseFaqAnswerId({ screen: "menu" }), null);
  assertEquals(parseFaqAnswerId(null), null);
  assertEquals(parseFaqAnswerId({ faq_answer_id: "1" }), null);
});
