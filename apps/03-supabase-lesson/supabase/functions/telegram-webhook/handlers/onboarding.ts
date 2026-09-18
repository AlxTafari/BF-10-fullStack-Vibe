import { getCamps } from "../../_shared/repositories/campsRepo.ts";
import { campButtonLabel } from "../../_shared/content.ts";
import { setUserCamp, setUserName } from "../../_shared/repositories/usersRepo.ts";
import type { InlineKeyboard } from "../../_shared/telegram/types.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function askName(ctx: HandlerContext, user: UserRow): Promise<void> {
  await reply(ctx, user.id, "Странная деревня рада гостю. Как тебя здесь называть?");
}

export async function handleNameAnswer(
  ctx: HandlerContext,
  user: UserRow,
  name: string,
): Promise<void> {
  const updated = await setUserName(ctx.client, user.id, name);
  await askCamp(ctx, updated);
}

export async function askCamp(ctx: HandlerContext, user: UserRow): Promise<void> {
  const camps = await getCamps(ctx.client);
  const keyboard: InlineKeyboard = camps.map((camp) => [
    { text: campButtonLabel(camp.name), callback_data: `camp:${camp.id}` },
  ]);
  await reply(ctx, user.id, `${user.name}, к какому лагерю ты примкнёшь?`, keyboard);
}

export async function handleCampSelected(
  ctx: HandlerContext,
  user: UserRow,
  campId: string,
): Promise<UserRow> {
  const updated = await setUserCamp(ctx.client, user.id, campId);
  await reply(
    ctx,
    updated.id,
    `Добро пожаловать в деревню, ${updated.name}! Твой лагерь выбран. Просто напиши что-нибудь — и у костра тебе перескажут местную сплетню.\n\nХочешь пустить свою сплетню — жми кнопку ниже: вставит @бота в поле ввода, допиши текст и выбери вариант публикации.`,
    [[{ text: "✍️ Написать сплетню", switch_inline_query_current_chat: "" }]],
  );
  return updated;
}
