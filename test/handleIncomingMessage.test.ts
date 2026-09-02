import { describe, expect, it } from "vitest";
import type { Messenger } from "../src/application/ports/Messenger.js";
import { handleIncomingMessage } from "../src/application/useCases/handleIncomingMessage.js";
import { fakeProvider } from "./support/fakeProvider.js";

function fakeMessenger() {
  const sent: { chatId: number; text: string }[] = [];
  const messenger: Messenger = {
    sendMessage: (chatId, text) => {
      sent.push({ chatId, text });
      return Promise.resolve();
    },
  };
  return { messenger, sent };
}

function run(
  text: string,
  deps = { provider: fakeProvider() },
  chatType = "private",
) {
  const { messenger, sent } = fakeMessenger();
  return handleIncomingMessage(
    { chatId: 1, text, chatType },
    { ...deps, messenger },
  ).then(() => sent[0]?.text ?? "");
}

describe("handleIncomingMessage", () => {
  it("/start отвечает справкой", async () => {
    expect(await run("/start")).toContain("курсы валют");
  });

  it("/rates@some_bot тоже срабатывает (группы)", async () => {
    expect(await run("/rates@currency_bot")).toContain("Курсы к доллару США");
  });

  it("/source показывает провайдер", async () => {
    expect(await run("/source")).toContain("fake");
  });

  it("один код -> курс к USD", async () => {
    expect(await run("курс JPY")).toContain("JPY");
  });

  it("русское название -> курс", async () => {
    expect(await run("сколько стоит евро")).toContain("EUR");
  });

  it("сумма + пара -> конвертация", async () => {
    const reply = await run("100 EUR в GBP");
    expect(reply).toContain("100 EUR =");
    expect(reply).toContain("GBP");
  });

  it("два кода -> кросс-курс", async () => {
    expect(await run("EUR GBP")).toContain("EUR");
  });

  it("только USD -> подсказка про базу", async () => {
    expect(await run("USD")).toContain("база отсчёта");
  });

  it("нет валют -> подсказка", async () => {
    expect(await run("привет")).toContain("Не нашёл валюту");
  });

  it("валюты нет у провайдера -> отдельное сообщение (не 'недоступен')", async () => {
    // снимок без RUB
    const reply = await run("RUB", { provider: fakeProvider({ EUR: 0.9 }) });
    expect(reply).toContain("нет курса для RUB");
    expect(reply).not.toContain("недоступен");
  });

  it("в группе свободный текст игнорируется", async () => {
    expect(await run("на реал не хватает", { provider: fakeProvider() }, "group")).toBe("");
    expect(await run("курс EUR", { provider: fakeProvider() }, "supergroup")).toBe("");
  });

  it("в группе команды работают", async () => {
    const reply = await run(
      "/rates@currency_bot",
      { provider: fakeProvider() },
      "group",
    );
    expect(reply).toContain("Курсы к доллару США");
  });

  it("ошибка провайдера -> нейтральный текст, ошибка в логе", async () => {
    const { messenger, sent } = fakeMessenger();
    const errors: unknown[] = [];
    const provider = {
      name: "boom",
      getSnapshot: () => Promise.reject(new Error("network down")),
    };
    await handleIncomingMessage(
      { chatId: 1, text: "EUR" },
      { provider, messenger, logError: (e) => errors.push(e) },
    );
    expect(sent[0]?.text).toContain("недоступен");
    expect(errors).toHaveLength(1);
  });
});
