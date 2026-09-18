import { IMPERSONAL_INTROS, NAMED_INTROS, REACTIONS } from "../../_shared/content.ts";
import { attributeNews } from "../../_shared/domain/gossip.ts";
import { resolveGossipFeed } from "../../_shared/domain/feedFallback.ts";
import { getAuthorsByIds, getCampNews, getFillerNews } from "../../_shared/repositories/newsRepo.ts";
import { getReactionCounts, getUserReaction } from "../../_shared/repositories/reactionsRepo.ts";
import type { InlineKeyboard } from "../../_shared/telegram/types.ts";
import type { UserRow } from "../../_shared/types.ts";
import { logMessage } from "../../_shared/repositories/messagesRepo.ts";
import type { HandlerContext } from "../context.ts";

const TOP_COUNT = 3;
const TOP_MEDALS = ["🥇", "🥈", "🥉"];
const SECTION_DIVIDER = "━━━━━━━━━━━━━━";

// Русское склонение "реакция/реакции/реакций" по числу.
function reactionWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "реакция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "реакции";
  return "реакций";
}

async function buildGossipListView(
  ctx: HandlerContext,
  user: UserRow,
  requestedIndex: number,
): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  if (!user.camp_id) return null;

  const [campNews, fillerNews] = await Promise.all([
    getCampNews(ctx.client, user.camp_id),
    getFillerNews(ctx.client),
  ]);
  const { items, usedFallback } = resolveGossipFeed(campNews, fillerNews);
  if (items.length === 0) {
    return { text: "🔥 У костра сегодня тихо — сплетен пока нет.", keyboard: [] };
  }

  const index = Math.min(Math.max(requestedIndex, 0), items.length - 1);
  const current = items[index];

  const authorIds = [...new Set(items.map((n) => n.author_id).filter((id): id is string => !!id))];
  const authors = await getAuthorsByIds(ctx.client, authorIds);

  const counts = await getReactionCounts(ctx.client, items.map((n) => n.id));
  const totalCount = (newsId: string) =>
    Object.values(counts.get(newsId) ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);

  const top = [...items]
    .map((news) => ({ news, count: totalCount(news.id) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_COUNT);

  const topLines = top
    .map((entry, i) => {
      const snippet = entry.news.text.length > 60 ? `${entry.news.text.slice(0, 60)}…` : entry.news.text;
      return `${TOP_MEDALS[i]} «${snippet}» — ${entry.count} ${reactionWord(entry.count)}`;
    })
    .join("\n");

  const author = current.author_id ? authors.get(current.author_id) ?? null : null;
  const attributed = attributeNews(current, author, NAMED_INTROS, IMPERSONAL_INTROS);
  const fallbackNote = usedFallback
    ? "\n💭 у твоего лагеря пока нет своих сплетен — держи общие"
    : "";

  const currentCounts = counts.get(current.id) ?? {};
  const reactionLine = REACTIONS.map((r) => `${r.emoji} ${currentCounts[r.type] ?? 0}`).join("  ");
  const userReaction = await getUserReaction(ctx.client, user.id, current.id);

  const text = [
    "🏆 ТОП СПЛЕТЕН ЛАГЕРЯ",
    SECTION_DIVIDER,
    topLines || "пока тишина, реакций ещё нет",
    "",
    `📖 Страница ${index + 1} из ${items.length}${fallbackNote}`,
    "",
    SECTION_DIVIDER,
    attributed,
    "",
    reactionLine,
  ].join("\n");

  const keyboard: InlineKeyboard = [];
  const navRow = [];
  if (index > 0) navRow.push({ text: "⬅️", callback_data: `gl:${index - 1}` });
  if (index < items.length - 1) navRow.push({ text: "➡️", callback_data: `gl:${index + 1}` });
  if (navRow.length > 0) keyboard.push(navRow);

  keyboard.push(
    REACTIONS.map((r) => ({
      text: r.type === userReaction ? `✅${r.emoji}` : r.emoji,
      callback_data: `rx:${index}:${current.id}:${r.type}`,
    })),
  );

  return { text, keyboard };
}

export async function handleGossipList(ctx: HandlerContext, user: UserRow): Promise<void> {
  const view = await buildGossipListView(ctx, user, 0);
  if (!view) return;
  await ctx.tg.sendMessage(ctx.chatId, view.text, view.keyboard);
  await logMessage(ctx.client, { userId: user.id, direction: "out", text: view.text });
}

export async function updateGossipList(
  ctx: HandlerContext,
  user: UserRow,
  messageId: number,
  index: number,
): Promise<void> {
  const view = await buildGossipListView(ctx, user, index);
  if (!view) return;
  await ctx.tg.editMessageText(ctx.chatId, messageId, view.text, view.keyboard);
}
