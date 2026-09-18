import { IMPERSONAL_INTROS, NAMED_INTROS, REACTIONS } from "../../_shared/content.ts";
import { attributeNews } from "../../_shared/domain/gossip.ts";
import { resolveGossipFeed } from "../../_shared/domain/feedFallback.ts";
import { getAuthorsByIds, getCampNews, getFillerNews } from "../../_shared/repositories/newsRepo.ts";
import { getReactionCounts } from "../../_shared/repositories/reactionsRepo.ts";
import type { InlineKeyboard } from "../../_shared/telegram/types.ts";
import type { UserRow } from "../../_shared/types.ts";
import { logMessage } from "../../_shared/repositories/messagesRepo.ts";
import type { HandlerContext } from "../context.ts";

const TOP_COUNT = 3;

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
    return { text: "У костра сегодня тихо — сплетен пока нет.", keyboard: [] };
  }

  const index = Math.min(Math.max(requestedIndex, 0), items.length - 1);
  const current = items[index];

  const authorIds = [...new Set(items.map((n) => n.author_id).filter((id): id is string => !!id))];
  const authors = await getAuthorsByIds(ctx.client, authorIds);

  const counts = await getReactionCounts(ctx.client, items.map((n) => n.id));
  const top = [...items]
    .map((news) => ({ news, count: counts.get(news.id) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_COUNT);

  const topLines = top
    .map((entry, i) => {
      const snippet = entry.news.text.length > 60 ? `${entry.news.text.slice(0, 60)}…` : entry.news.text;
      return `${i + 1}. «${snippet}» — ${entry.count} реакций`;
    })
    .join("\n");

  const author = current.author_id ? authors.get(current.author_id) ?? null : null;
  const attributed = attributeNews(current, author, NAMED_INTROS, IMPERSONAL_INTROS);
  const fallbackNote = usedFallback
    ? "\n(у твоего лагеря пока нет своих сплетен — показываю общие)"
    : "";

  const text = [
    "🏆 Топ сплетен лагеря:",
    topLines || "пока без реакций",
    "",
    `Страница ${index + 1}/${items.length}${fallbackNote}`,
    attributed,
  ].join("\n");

  const keyboard: InlineKeyboard = [];
  const navRow = [];
  if (index > 0) navRow.push({ text: "⬅️", callback_data: `gl:${index - 1}` });
  if (index < items.length - 1) navRow.push({ text: "➡️", callback_data: `gl:${index + 1}` });
  if (navRow.length > 0) keyboard.push(navRow);

  keyboard.push(
    REACTIONS.map((r) => ({
      text: r.emoji,
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
