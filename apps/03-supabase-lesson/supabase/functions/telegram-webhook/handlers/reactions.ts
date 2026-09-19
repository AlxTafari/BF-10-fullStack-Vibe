import { upsertReaction } from "../../_shared/repositories/reactionsRepo.ts";
import type { ReactionType, UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { updateChronicle } from "./chronicle.ts";

export async function handleReaction(
  ctx: HandlerContext,
  user: UserRow,
  callbackQueryId: string,
  messageId: number,
  params: { index: number; newsId: string; reactionType: ReactionType },
): Promise<void> {
  await upsertReaction(ctx.client, {
    userId: user.id,
    newsId: params.newsId,
    reactionType: params.reactionType,
  });
  await ctx.tg.answerCallbackQuery(callbackQueryId, "Спасибо, что поделился! 🔥");
  await updateChronicle(ctx, user, messageId, params.index);
}
