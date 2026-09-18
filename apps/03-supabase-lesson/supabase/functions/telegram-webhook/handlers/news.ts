import { insertNews } from "../../_shared/repositories/newsRepo.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function handlePostNews(
  ctx: HandlerContext,
  user: UserRow,
  params: { anonymous: boolean; text: string },
): Promise<void> {
  await insertNews(ctx.client, {
    authorId: params.anonymous ? null : user.id,
    campId: user.camp_id,
    text: params.text,
  });

  const confirmation = params.anonymous
    ? "🕶️ Анонимная сплетня ушла в лагерь — концов не найти."
    : "📰 Готово! Твою историю уже обсуждают в лагере.";
  await reply(ctx, user.id, confirmation);
}
