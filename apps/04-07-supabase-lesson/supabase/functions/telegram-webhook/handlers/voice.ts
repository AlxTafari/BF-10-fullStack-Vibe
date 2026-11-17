import {
  AI_FALLBACK,
  MAIN_MENU_KEYBOARD,
  VOICE_AI_OFF,
  VOICE_FAILED,
  VOICE_MANAGER_TOO_LONG,
  VOICE_ON_CARD_FAILED,
  VOICE_ON_STEP,
  VOICE_TOO_LONG,
  VOICE_UNCLEAR,
} from "../../_shared/content.ts";
import { isHandoffActive } from "../../_shared/domain/managerChat.ts";
import { routeVoice, VOICE_MAX_BYTES, VOICE_PLACEHOLDER } from "../../_shared/domain/voice.ts";
import { isAiLimitReached } from "../../_shared/services/ai/agent.ts";
import { transcribeAudio } from "../../_shared/services/ai/voice.ts";
import { getAiSettings } from "../../_shared/services/aiSettings.ts";
import { TelegramApiError } from "../../_shared/telegram/client.ts";
import type { FlowState } from "../../_shared/domain/flowState.ts";
import type { TelegramVoice } from "../../_shared/telegram/types.ts";
import type { VoiceMeta } from "../../_shared/types.ts";
import type { HandlerContext } from "../context.ts";
import { logIncoming, reply } from "../logging.ts";
import { handleAiText, startTyping } from "./ai.ts";
import { handleFlowText } from "./flow.ts";

/**
 * Голосовое гостя (S09, сессия 4). Куда оно идёт, решает domain/voice.ts (routeVoice). Голосовое пишется в журнал
 * в любом случае: менеджер слушает его в админке и может распознать кнопкой. Автоматически распознаётся только
 * то, что идёт агенту: расшифровка встаёт в messages.text вместо заглушки, и дальше работает обычный ход агента —
 * он читает реплику гостя из журнала.
 * На карточке-сводке (S09) расшифровка идёт тем же путём, что текст на карточке: агент различает поправку,
 * пожелание и вопрос (handlers/flow.ts).
 * flowState — живой пошаговый сценарий гостя (бронь, обращение) или null.
 */
export async function handleVoice(ctx: HandlerContext, voice: TelegramVoice, flowState: FlowState | null): Promise<void> {
  const handoffActive = isHandoffActive(ctx.conversation.handoff_until, new Date());
  const hasLiveFlow = flowState !== null;
  const onCard = flowState?.step === "confirm" || flowState?.step === "edit";
  // Настройки AI нужны, только если голос может пойти агенту: на обычном шаге и в ручном режиме лишнего запроса нет.
  const settings = (!hasLiveFlow || onCard) && !handoffActive && ctx.llm
    ? await getAiSettings(ctx.client, ctx.conversation.restaurant_id)
    : null;
  const route = routeVoice({
    durationSec: voice.duration,
    fileSize: voice.file_size,
    hasLiveFlow,
    onCard,
    handoffActive,
    aiAvailable: settings?.aiEnabled === true,
  });

  const base: VoiceMeta = {
    fileId: voice.file_id,
    duration: voice.duration,
    ...(voice.mime_type ? { mimeType: voice.mime_type } : {}),
    ...(voice.file_size !== undefined ? { fileSize: voice.file_size } : {}),
  };
  // Заглушка вместо текста: превью в админке и история агента видят, что был голос.
  const logPlaceholder = (extra: Partial<VoiceMeta> = {}) => logIncoming(ctx, VOICE_PLACEHOLDER, "text", { voice: { ...base, ...extra } });

  switch (route) {
    case "manager":
      // Ручной режим (S06b): бот молчит, как на текст. Менеджер видит голосовое в чате админки.
      await logPlaceholder();
      return;
    case "manager_too_long":
      // Бот в ручном режиме молчит, но это служебная просьба, а не ответ по существу — как MANAGER_TEXT_ONLY.
      await logPlaceholder();
      await reply(ctx, VOICE_MANAGER_TOO_LONG);
      return;
    case "text_only":
      await logPlaceholder();
      if (hasLiveFlow) await reply(ctx, VOICE_ON_STEP);
      else await reply(ctx, VOICE_AI_OFF, MAIN_MENU_KEYBOARD);
      return;
    case "too_long":
      await logPlaceholder();
      await reply(ctx, VOICE_TOO_LONG);
      return;
  }

  // route = "agent" | "card": settings и llm точно есть (иначе aiAvailable = false), но TypeScript этого не видит.
  if (!settings || !ctx.llm) return;
  // Лимит исчерпан — агенту нечем ответить: не распознаём (не тратим токены), ответ как при лимите у текста.
  // На карточке — без главного меню: гость остаётся на ней, «✏️ Исправить» работает без AI.
  if (await isAiLimitReached(ctx.client, ctx.conversation, settings)) {
    await logPlaceholder();
    if (route === "card") await reply(ctx, VOICE_ON_CARD_FAILED, undefined, "text", { aiFallback: "limit" });
    else await reply(ctx, AI_FALLBACK, MAIN_MENU_KEYBOARD, "text", { aiFallback: "limit" });
    return;
  }

  const stopTyping = startTyping(ctx);
  let text: string | null = null;
  let extra: Partial<VoiceMeta>;
  try {
    const file = await download(ctx, voice.file_id);
    if (!file) {
      extra = { transcribeError: "download" };
    } else {
      const outcome = await transcribeAudio(ctx.llm, { bytes: file, mimeType: voice.mime_type });
      text = outcome.text;
      extra = outcome.meta;
    }
  } finally {
    stopTyping();
  }

  if (text) {
    await logIncoming(ctx, text, "text", { voice: { ...base, ...extra, transcribedBy: "auto" } });
    if (route === "card" && flowState) await handleFlowText(ctx, flowState, text);
    else await handleAiText(ctx, settings);
    return;
  }
  await logPlaceholder(extra);
  if (extra.transcribeError === "unclear") await reply(ctx, VOICE_UNCLEAR);
  else if (route === "card") await reply(ctx, VOICE_ON_CARD_FAILED);
  else await reply(ctx, VOICE_FAILED, MAIN_MENU_KEYBOARD);
}

/** Файл голосового или null — Telegram не отдал (сбой сети, файл больше VOICE_MAX_BYTES). В лог — только код. */
async function download(ctx: HandlerContext, fileId: string): Promise<Uint8Array | null> {
  try {
    return (await ctx.tg.downloadFile(fileId, VOICE_MAX_BYTES)).bytes;
  } catch (error) {
    console.error("voice download failed:", error instanceof TelegramApiError ? `telegram ${error.errorCode}` : "network");
    return null;
  }
}
