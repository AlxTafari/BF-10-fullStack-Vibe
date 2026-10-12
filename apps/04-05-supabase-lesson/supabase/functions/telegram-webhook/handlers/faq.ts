import {
  FAQ_ANSWER_KEYBOARD,
  FAQ_EMPTY,
  FAQ_NOT_FOUND,
  FAQ_PROMPT,
  faqListKeyboard,
  HOME_KEYBOARD,
} from "../../_shared/content.ts";
import { getFaqAnswer, listFaq } from "../../_shared/services/faq.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function handleFaqList(ctx: HandlerContext): Promise<void> {
  const items = await listFaq(ctx.client);
  if (items.length === 0) {
    await reply(ctx, FAQ_EMPTY, HOME_KEYBOARD);
    return;
  }
  await reply(ctx, FAQ_PROMPT, faqListKeyboard(items));
}

export async function handleFaqAnswer(ctx: HandlerContext, faqId: string): Promise<void> {
  const faq = await getFaqAnswer(ctx.client, { faqId });
  if (!faq) {
    await reply(ctx, FAQ_NOT_FOUND, HOME_KEYBOARD);
    return;
  }
  await reply(ctx, `${faq.question}\n\n${faq.answer}`, FAQ_ANSWER_KEYBOARD);
}
