import type { Messenger } from "../../application/ports/Messenger.js";

/**
 * Реализация порта Messenger поверх Telegram Bot API.
 * Голый fetch, без сторонних SDK.
 */

export interface TelegramMessengerOptions {
  botToken: string;
  fetchImpl?: typeof fetch;
}

export function createTelegramMessenger(
  options: TelegramMessengerOptions,
): Messenger {
  const doFetch = options.fetchImpl ?? fetch;
  const apiBase = `https://api.telegram.org/bot${options.botToken}`;

  return {
    async sendMessage(chatId: number, text: string): Promise<void> {
      const response = await doFetch(`${apiBase}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Telegram sendMessage: HTTP ${response.status} ${detail}`,
        );
      }
    },
  };
}
