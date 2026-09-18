import type { TelegramInlineQuery, InlineQueryResultArticle } from "../../_shared/telegram/types.ts";
import type { HandlerContext } from "../context.ts";

/**
 * Инлайн-режим (@bot_username <текст> в поле ввода без отправки): даёт выбор "обычно / анонимно",
 * итог — обычное сообщение вида /новость "текст", попадает в router и обрабатывается как всегда.
 */
export async function handleInlineQuery(ctx: HandlerContext, iq: TelegramInlineQuery): Promise<void> {
  const text = iq.query.trim();
  const preview = text ? (text.length > 80 ? `${text.slice(0, 80)}…` : text) : "начни печатать текст сплетни";

  const results: InlineQueryResultArticle[] = [
    {
      type: "article",
      id: "regular",
      title: "📰 Опубликовать как есть",
      description: preview,
      input_message_content: { message_text: `/новость "${text}"` },
    },
    {
      type: "article",
      id: "anon",
      title: "🕶️ Опубликовать анонимно",
      description: preview,
      input_message_content: { message_text: `/новость анонимно "${text}"` },
    },
  ];

  await ctx.tg.answerInlineQuery(iq.id, results);
}
