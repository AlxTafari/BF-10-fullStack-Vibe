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

  // Лагерь у всех сейчас один и тот же (нейтралитет, см. docs/GAME_DESIGN_REVIEW.md 6.1) — в списке не показываем.
  const lines = residents.map((r) => `• ${r.user.name ?? "безымянный"} — сплетен: ${r.newsCount}`);
  await reply(
    ctx,
    user.id,
    `👥 ЖИТЕЛИ ДЕРЕВНИ\nза последние 30 дней\n━━━━━━━━━━━━━━\n${lines.join("\n")}`,
  );
}
