import {
  IMPERSONAL_INTROS,
  NAMED_INTROS,
  TERMINAL_REFUSAL_PHRASE,
  VILLAGE_FRAGMENTS,
} from "../../_shared/content.ts";
import { attributeNews } from "../../_shared/domain/attribution.ts";
import { formatTerminalDate } from "../../_shared/domain/calendar.ts";
import { pickRandom } from "../../_shared/domain/randomPick.ts";
import { getAuthorsByIds, getStoryPool } from "../../_shared/repositories/newsRepo.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

// Любое сообщение реагирует по-разному в зависимости от сцены (village/campfire) — см. docs/GAME_DESIGN_REVIEW.md, раздел 7.
export async function handleFreeText(ctx: HandlerContext, user: UserRow): Promise<void> {
  if (user.scene === "campfire") {
    await reply(ctx, user.id, TERMINAL_REFUSAL_PHRASE);
    await tellTerminalStory(ctx, user);
    return;
  }

  const fragment = pickRandom(VILLAGE_FRAGMENTS);
  if (!fragment) return;
  await reply(ctx, user.id, `${fragment}\n\n👉 Выбери действие в меню.`);
}

/** "Осмотреться" — тот же фрагмент лора, что и на любое сообщение в деревне, но без подписи-призыва к меню. */
export async function handleLookAround(ctx: HandlerContext, user: UserRow): Promise<void> {
  const fragment = pickRandom(VILLAGE_FRAGMENTS);
  if (!fragment) return;
  await reply(ctx, user.id, fragment);
}

/** Терминал у костра рассказывает одну случайную историю — используется и на "/история", и после отказа отвечать напрямую. */
export async function tellTerminalStory(ctx: HandlerContext, user: UserRow): Promise<void> {
  const campId = user.camp_id;
  if (!campId) return;

  const pool = await getStoryPool(ctx.client, campId);
  const news = pickRandom(pool);
  if (!news) {
    await reply(ctx, user.id, "🔥 Терминал молчит — историй пока нет.");
    return;
  }

  const authors = news.author_id
    ? await getAuthorsByIds(ctx.client, [news.author_id])
    : new Map<string, { id: string; name: string | null }>();
  const author = news.author_id ? authors.get(news.author_id) ?? null : null;

  const attributed = attributeNews(news, author, NAMED_INTROS, IMPERSONAL_INTROS);
  await reply(ctx, user.id, `📟 ${attributed}\n\n🗓️ Запись от ${formatTerminalDate(news.created_at)}.`);
}
