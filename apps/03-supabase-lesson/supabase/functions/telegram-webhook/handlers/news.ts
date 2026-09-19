import { countNewsPostedToday, insertNews } from "../../_shared/repositories/newsRepo.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export const NEWS_TEXT_MAX_LENGTH = 80;
const MAX_REGULAR_NEWS_PER_DAY = 5;
const MAX_ANON_NEWS_PER_DAY = 2;

export async function handlePostNews(
  ctx: HandlerContext,
  user: UserRow,
  params: { anonymous: boolean; text: string },
): Promise<void> {
  if (user.scene !== "campfire") {
    await reply(ctx, user.id, "📰 Подойди к терминалу, чтобы поделиться новостью.");
    return;
  }

  if (params.text.length > NEWS_TEXT_MAX_LENGTH) {
    await reply(
      ctx,
      user.id,
      `✂️ Весть длинновата — уложись в ${NEWS_TEXT_MAX_LENGTH} символов, у костра любят покороче.`,
    );
    return;
  }

  const postedToday = await countNewsPostedToday(ctx.client, user.id, params.anonymous);
  const dailyLimit = params.anonymous ? MAX_ANON_NEWS_PER_DAY : MAX_REGULAR_NEWS_PER_DAY;
  if (postedToday >= dailyLimit) {
    const limitMessage = params.anonymous
      ? "🕶️ Анонимных вестей на сегодня хватит — дай тайне отдохнуть до завтра."
      : "🌙 На сегодня вестей от тебя уже достаточно — деревня устала слушать. Возвращайся завтра.";
    await reply(ctx, user.id, limitMessage);
    return;
  }

  await insertNews(ctx.client, {
    authorId: params.anonymous ? null : user.id,
    postedBy: user.id,
    campId: user.camp_id,
    text: params.text,
  });

  const confirmation = params.anonymous
    ? "🕶️ Анонимная весть ушла в деревню — концов не найти."
    : "📰 Готово! Твою историю уже обсуждают в деревне.";
  await reply(ctx, user.id, confirmation);
}
