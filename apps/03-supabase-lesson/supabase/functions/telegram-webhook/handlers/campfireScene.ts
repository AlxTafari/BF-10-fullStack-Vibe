import { mainMenuForScene } from "../../_shared/content.ts";
import { setUserScene } from "../../_shared/repositories/usersRepo.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";
import { tellTerminalStory } from "./freeTextReply.ts";

export async function handleSitByFire(ctx: HandlerContext, user: UserRow): Promise<void> {
  if (user.scene === "campfire") {
    await reply(ctx, user.id, "🔥 Ты уже сидишь у костра.");
    return;
  }
  const updated = await setUserScene(ctx.client, user.id, "campfire");
  await reply(
    ctx,
    updated.id,
    "🔥 Ты садишься у костра. Рядом — старый терминал, обмотанный проволокой; он всегда сидит на одном и том же месте.",
    undefined,
    mainMenuForScene("campfire"),
  );
}

export async function handleStandUp(ctx: HandlerContext, user: UserRow): Promise<void> {
  if (user.scene !== "campfire") {
    await reply(ctx, user.id, "🚶 Ты и так не у костра.");
    return;
  }
  const updated = await setUserScene(ctx.client, user.id, "village");
  await reply(
    ctx,
    updated.id,
    "🚶 Ты встаёшь и отходишь от костра — обратно в деревню.",
    undefined,
    mainMenuForScene("village"),
  );
}

export async function handleHearStory(ctx: HandlerContext, user: UserRow): Promise<void> {
  if (user.scene !== "campfire") {
    await reply(ctx, user.id, "🔥 Историю рассказывают только у костра.");
    return;
  }
  await tellTerminalStory(ctx, user);
}
