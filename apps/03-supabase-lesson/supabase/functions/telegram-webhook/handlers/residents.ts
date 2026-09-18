import { campButtonLabel } from "../../_shared/content.ts";
import { listActiveResidents } from "../../_shared/repositories/usersRepo.ts";
import type { UserRow } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { reply } from "../logging.ts";

export async function handleResidents(ctx: HandlerContext, user: UserRow): Promise<void> {
  const residents = await listActiveResidents(ctx.client);
  if (residents.length === 0) {
    await reply(ctx, user.id, "🏕️ За последние 30 дней в деревне никого не видели — тишина.");
    return;
  }

  const lines = residents.map((r) => {
    const camp = r.campName ? campButtonLabel(r.campName) : "без лагеря";
    return `• ${r.user.name ?? "безымянный"} — ${camp}, сплетен: ${r.newsCount}`;
  });
  await reply(
    ctx,
    user.id,
    `👥 ЖИТЕЛИ ДЕРЕВНИ\nза последние 30 дней\n━━━━━━━━━━━━━━\n${lines.join("\n")}`,
  );
}
