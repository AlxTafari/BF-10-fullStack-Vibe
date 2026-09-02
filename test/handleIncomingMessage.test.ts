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

describe("handleIncomingMessage", () => {
  it("/start отвечает справкой", async () => {
    const { messenger, sent } = fakeMessenger();
    await handleIncomingMessage(
      { chatId: 1, text: "/start" },
      { provider: fakeProvider(), messenger },
    );
    expect(sent[0]?.text).toContain("ISO 4217");
  });

  it("один код -> курс к USD", async () => {
    const { messenger, sent } = fakeMessenger();
    await handleIncomingMessage(
      { chatId: 1, text: "курс JPY" },
      { provider: fakeProvider(), messenger },
    );
    expect(sent[0]?.text).toContain("JPY / USD");
  });

  it("два кода -> кросс-курс", async () => {
    const { messenger, sent } = fakeMessenger();
    await handleIncomingMessage(
      { chatId: 1, text: "EUR GBP" },
      { provider: fakeProvider(), messenger },
    );
    expect(sent[0]?.text).toContain("EUR / GBP");
  });

  it("нет кодов -> подсказка", async () => {
    const { messenger, sent } = fakeMessenger();
    await handleIncomingMessage(
      { chatId: 1, text: "привет" },
      { provider: fakeProvider(), messenger },
    );
    expect(sent[0]?.text).toContain("Не нашёл код валюты");
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
