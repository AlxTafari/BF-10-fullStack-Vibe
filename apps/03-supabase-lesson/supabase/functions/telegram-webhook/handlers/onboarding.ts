import { getCamps, getNeutralCamp } from "../../_shared/repositories/campsRepo.ts";
import { campButtonLabel, mainMenuForScene } from "../../_shared/content.ts";
import { setUserCamp, setUserName } from "../../_shared/repositories/usersRepo.ts";
import type { InlineKeyboard } from "../../_shared/telegram/types.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function askName(ctx: HandlerContext, user: UserRow): Promise<void> {
  await reply(ctx, user.id, "🌲 Странная деревня встречает нового гостя...\n\nКак тебя здесь называть?");
}

// Выбор лагеря кнопкой временно отключён — новый житель садится у костра нейтралитета
// (askCamp/handleCampSelected ниже не удалены, пригодятся, когда выбор лагеря вернётся).
export async function handleNameAnswer(
  ctx: HandlerContext,
  user: UserRow,
  name: string,
): Promise<void> {
  const updated = await setUserName(ctx.client, user.id, name);
  const neutralCamp = await getNeutralCamp(ctx.client);
  if (!neutralCamp) {
    await askCamp(ctx, updated);
    return;
  }
  await handleCampSelected(ctx, updated, neutralCamp.id);
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
    `🎉 Добро пожаловать в деревню, ${updated.name}!\n\nТы стоишь на центральной площади. Рядом — костёр со старым терминалом; чуть дальше — дома, кузница, колодец.\n\n💬 Просто напиши что-нибудь — деревня отзовётся. 🔥 Хочешь рассказать свою историю терминалу — садись у костра (кнопка в меню).`,
  );
  await reply(ctx, updated.id, "📋 Меню деревни теперь всегда под рукой ↓", undefined, mainMenuForScene("village"));
  return updated;
}
