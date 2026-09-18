import { getCamps } from "../../_shared/repositories/campsRepo.ts";
import { campButtonLabel, MAIN_MENU } from "../../_shared/content.ts";
import { setUserCamp, setUserName } from "../../_shared/repositories/usersRepo.ts";
import type { InlineKeyboard } from "../../_shared/telegram/types.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function askName(ctx: HandlerContext, user: UserRow): Promise<void> {
  await reply(ctx, user.id, "🌲 Странная деревня встречает нового гостя...\n\nКак тебя здесь называть?");
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
  await reply(ctx, user.id, `🏕️ ${user.name}, у костра выбирают сторону.\n\nК какому лагерю ты примкнёшь?`, keyboard);
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
    `🎉 Добро пожаловать в деревню, ${updated.name}!\n\nТвой лагерь выбран — теперь ты свой у этого костра.\n\n💬 Просто напиши что-нибудь — тебе перескажут местную сплетню.\n📰 Хочешь пустить свою — жми кнопку ниже.`,
    [[{ text: "✍️ Написать сплетню", switch_inline_query_current_chat: "" }]],
  );
  await reply(ctx, updated.id, "📋 Меню деревни теперь всегда под рукой ↓", undefined, MAIN_MENU);
  return updated;
}
