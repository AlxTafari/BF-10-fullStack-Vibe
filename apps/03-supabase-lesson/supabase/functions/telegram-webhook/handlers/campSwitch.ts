import { campDativeLabel } from "../../_shared/content.ts";
import { getOtherCamp } from "../../_shared/repositories/campsRepo.ts";
import { setUserCamp } from "../../_shared/repositories/usersRepo.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function handleSwitchCamp(ctx: HandlerContext, user: UserRow): Promise<void> {
  if (!user.camp_id) return;
  const otherCamp = await getOtherCamp(ctx.client, user.camp_id);
  if (!otherCamp) {
    await reply(ctx, user.id, "🏕️ Другого лагеря пока нет — ты и так на своём месте.");
    return;
  }
  await setUserCamp(ctx.client, user.id, otherCamp.id);
  await reply(ctx, user.id, `🔥 Теперь ты примкнул к ${campDativeLabel(otherCamp.name)}. Осваивайся у нового костра!`);
}
