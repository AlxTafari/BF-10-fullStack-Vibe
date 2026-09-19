import { parseCommand, parseNewsArgs } from "../_shared/commands.ts";
import { locationDescriptionForScene, mainMenuForScene, MENU_BUTTON_COMMANDS } from "../_shared/content.ts";
import { createPendingUser, findUserByTgId } from "../_shared/repositories/usersRepo.ts";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "../_shared/telegram/types.ts";
import type { ReactionType, UserRow } from "../_shared/types.ts";
import type { HandlerContext } from "./context.ts";
import { logIncoming, reply } from "./logging.ts";
import { askCamp, askName, handleCampSelected, handleNameAnswer } from "./handlers/onboarding.ts";
import { handlePostNews } from "./handlers/news.ts";
import { handleFreeText, handleLookAround } from "./handlers/freeTextReply.ts";
import { handleChronicle, updateChronicle } from "./handlers/chronicle.ts";
import { handleResidents } from "./handlers/residents.ts";
import { handleHearStory, handleSitByFire, handleStandUp } from "./handlers/campfireScene.ts";
import { handleReaction } from "./handlers/reactions.ts";
import { handleInlineQuery } from "./handlers/inlineNews.ts";
import { handleAbout } from "./handlers/about.ts";

const NEWS_INLINE_HINT_KEYBOARD = [
  [{ text: "✍️ Написать весть", switch_inline_query_current_chat: "" }],
];

const START_COMMAND = /^\/start(@\S+)?$/i;

export async function routeUpdate(ctx: HandlerContext, update: TelegramUpdate): Promise<void> {
  if (update.message) {
    await handleMessage(ctx, update.message);
    return;
  }
  if (update.callback_query) {
    await handleCallbackQuery(ctx, update.callback_query);
    return;
  }
  if (update.inline_query) {
    await handleInlineQuery(ctx, update.inline_query);
  }
}

async function handleMessage(ctx: HandlerContext, message: TelegramMessage): Promise<void> {
  const tgId = message.from?.id;
  if (!tgId) return;

  const text = message.text ?? "";
  let user = await findUserByTgId(ctx.client, tgId);
  if (!user) user = await createPendingUser(ctx.client, tgId);

  await logIncoming(ctx, user.id, text);

  if (user.name === null) {
    if (text.trim().startsWith("/")) {
      await askName(ctx, user);
      return;
    }
    await handleNameAnswer(ctx, user, text.trim());
    return;
  }

  if (user.camp_id === null) {
    await askCamp(ctx, user);
    return;
  }

  if (START_COMMAND.test(text.trim())) {
    await reply(
      ctx,
      user.id,
      `${locationDescriptionForScene(user.scene)}\n\n👉 Выбери действие в меню.`,
      undefined,
      mainMenuForScene(user.scene),
    );
    return;
  }

  await routeOnboardedMessage(ctx, user, text);
}

async function routeOnboardedMessage(ctx: HandlerContext, user: UserRow, text: string): Promise<void> {
  // Кнопки нижнего меню шлют свой текст как обычное сообщение — разворачиваем его в команду.
  const fromMenuButton = MENU_BUTTON_COMMANDS[text.trim()];
  const parsed = parseCommand(fromMenuButton ?? text);
  if (!parsed) {
    await handleFreeText(ctx, user);
    return;
  }

  // Латинские алиасы — так их можно зарегистрировать в меню тг (setMyCommands не пускает кириллицу).
  switch (parsed.command) {
    case "/новость":
    case "/news": {
      const news = parseNewsArgs(parsed.args);
      if (!news) {
        await reply(
          ctx,
          user.id,
          '✏️ Не расслышал весть.\n\nНапиши так: /новость "текст"\nили анонимно: /новость анонимно "текст"\n\nЛибо жми кнопку ниже — она сама подставит @бота, останется дописать текст и выбрать, как публиковать.',
          NEWS_INLINE_HINT_KEYBOARD,
        );
        return;
      }
      await handlePostNews(ctx, user, news);
      return;
    }
    case "/хроника":
    case "/chronicle":
      await handleChronicle(ctx, user);
      return;
    case "/сменить_лагерь":
    case "/switch_camp":
      // Смена лагеря временно отключена — все жители сейчас держат нейтралитет (handleSwitchCamp не удалён, см. campSwitch.ts).
      await reply(ctx, user.id, "🏕️ Пока лагеря держат нейтралитет — переход временно недоступен.");
      return;
    case "/жители":
    case "/residents":
      await handleResidents(ctx, user);
      return;
    case "/что_здесь_происходит":
    case "/about":
      await handleAbout(ctx, user);
      return;
    case "/сесть_у_костра":
    case "/sit":
      await handleSitByFire(ctx, user);
      return;
    case "/встать":
    case "/stand":
      await handleStandUp(ctx, user);
      return;
    case "/история":
    case "/story":
      await handleHearStory(ctx, user);
      return;
    case "/осмотреться":
    case "/look":
      await handleLookAround(ctx, user);
      return;
    default:
      await reply(ctx, user.id, "🤷 Такая команда деревне неизвестна.");
  }
}

async function handleCallbackQuery(ctx: HandlerContext, cq: TelegramCallbackQuery): Promise<void> {
  const tgId = cq.from.id;
  const data = cq.data ?? "";
  const messageId = cq.message?.message_id;

  const user = await findUserByTgId(ctx.client, tgId);
  if (!user || !messageId) {
    await ctx.tg.answerCallbackQuery(cq.id);
    return;
  }

  if (data.startsWith("camp:")) {
    const campId = data.slice("camp:".length);
    await ctx.tg.answerCallbackQuery(cq.id);
    await handleCampSelected(ctx, user, campId);
    return;
  }

  if (data.startsWith("ch:")) {
    const index = Number(data.slice("ch:".length));
    await ctx.tg.answerCallbackQuery(cq.id);
    await updateChronicle(ctx, user, messageId, index);
    return;
  }

  if (data.startsWith("rx:")) {
    const [, idxStr, newsId, type] = data.split(":");
    await handleReaction(ctx, user, cq.id, messageId, {
      index: Number(idxStr),
      newsId,
      reactionType: type as ReactionType,
    });
    return;
  }

  await ctx.tg.answerCallbackQuery(cq.id);
}
