import { ABOUT_TEXT } from "../../_shared/content.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function handleAbout(ctx: HandlerContext, user: UserRow): Promise<void> {
  await reply(ctx, user.id, ABOUT_TEXT);
}
