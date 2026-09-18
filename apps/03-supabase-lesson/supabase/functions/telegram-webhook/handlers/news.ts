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
    ? "Слух пущен анонимно — теперь его никто не свяжет с тобой."
    : "Готово, твоя история уже расходится по лагерю.";
  await reply(ctx, user.id, confirmation);
}
