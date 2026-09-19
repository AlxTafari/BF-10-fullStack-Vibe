import { IMPERSONAL_INTROS, NAMED_INTROS, REACTIONS } from "../../_shared/content.ts";
import { attributeNews } from "../../_shared/domain/attribution.ts";
import { formatTerminalDate } from "../../_shared/domain/calendar.ts";
import { buildChronicleFeed } from "../../_shared/domain/chronicleFeed.ts";
import { getAuthorsByIds, getCampNews, getFillerNews } from "../../_shared/repositories/newsRepo.ts";
import { getReactionCounts, getUserReaction } from "../../_shared/repositories/reactionsRepo.ts";
import type { InlineKeyboard } from "../../_shared/telegram/types.ts";
import type { UserRow } from "../../_shared/types.ts";
import { logMessage } from "../../_shared/repositories/messagesRepo.ts";
import type { HandlerContext } from "../context.ts";

const SECTION_DIVIDER = "· · ·";

async function buildChronicleView(
  ctx: HandlerContext,
  user: UserRow,
  requestedIndex: number,
): Promise<{ text: string; keyboard: InlineKeyboard } | null> {
  if (!user.camp_id) return null;

  const [userNews, fillerNews] = await Promise.all([
    getCampNews(ctx.client, user.camp_id),
    getFillerNews(ctx.client),
  ]);
  const items = buildChronicleFeed(userNews, fillerNews);
  if (items.length === 0) {
    return { text: "📜 Хроника пуста — вестей пока нет.", keyboard: [] };
  }

  const index = Math.min(Math.max(requestedIndex, 0), items.length - 1);
  const current = items[index];

  const authorIds = [...new Set(items.map((n) => n.author_id).filter((id): id is string => !!id))];
  const authors = await getAuthorsByIds(ctx.client, authorIds);

  const counts = await getReactionCounts(ctx.client, items.map((n) => n.id));

  const author = current.author_id ? authors.get(current.author_id) ?? null : null;
  const attributed = attributeNews(current, author, NAMED_INTROS, IMPERSONAL_INTROS);

  const currentCounts = counts.get(current.id) ?? {};
  const reactionLine = REACTIONS.map((r) => `${r.emoji} ${currentCounts[r.type] ?? 0}`).join("  ");
  const userReaction = await getUserReaction(ctx.client, user.id, current.id);

  const text = [
    "📜 ХРОНИКА ДЕРЕВНИ",
    SECTION_DIVIDER,
    `Запись ${index + 1} из ${items.length}`,
    `от ${formatTerminalDate(current.created_at)}`,
    "",
    attributed,
    "",
    reactionLine,
  ].join("\n");

  const keyboard: InlineKeyboard = [];
  const navRow = [];
  if (index > 0) navRow.push({ text: "⬅️", callback_data: `ch:${index - 1}` });
  if (index < items.length - 1) navRow.push({ text: "➡️", callback_data: `ch:${index + 1}` });
  if (navRow.length > 0) keyboard.push(navRow);

  keyboard.push(
    REACTIONS.map((r) => ({
      text: r.type === userReaction ? `✅${r.emoji}` : r.emoji,
      callback_data: `rx:${index}:${current.id}:${r.type}`,
    })),
  );

  return { text, keyboard };
}

export async function handleChronicle(ctx: HandlerContext, user: UserRow): Promise<void> {
  const view = await buildChronicleView(ctx, user, 0);
  if (!view) return;
  await ctx.tg.sendMessage(ctx.chatId, view.text, view.keyboard);
  await logMessage(ctx.client, { userId: user.id, direction: "out", text: view.text });
}

export async function updateChronicle(
  ctx: HandlerContext,
  user: UserRow,
  messageId: number,
  index: number,
): Promise<void> {
  const view = await buildChronicleView(ctx, user, index);
  if (!view) return;
  await ctx.tg.editMessageText(ctx.chatId, messageId, view.text, view.keyboard);
}
