import { IMPERSONAL_INTROS, NAMED_INTROS, TEASER_PHRASES } from "../../_shared/content.ts";
import { attributeNews } from "../../_shared/domain/gossip.ts";
import { pickRandom } from "../../_shared/domain/randomPick.ts";
import { getAuthorsByIds, getGossipPool } from "../../_shared/repositories/newsRepo.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function handleFreeText(ctx: HandlerContext, user: UserRow): Promise<void> {
  const campId = user.camp_id;
  if (!campId) return;

  const pool = await getGossipPool(ctx.client, campId);
  const news = pickRandom(pool);
  if (!news) {
    await reply(ctx, user.id, "У костра сегодня тихо — сплетен пока нет.");
    return;
  }

  const authors = news.author_id
    ? await getAuthorsByIds(ctx.client, [news.author_id])
    : new Map<string, { id: string; name: string | null }>();
  const author = news.author_id ? authors.get(news.author_id) ?? null : null;

  const teaser = pickRandom(TEASER_PHRASES) ?? "Слушай, что говорят";
  const attributed = attributeNews(news, author, NAMED_INTROS, IMPERSONAL_INTROS);

  await reply(ctx, user.id, `${teaser}\n\n${attributed}`);
}
