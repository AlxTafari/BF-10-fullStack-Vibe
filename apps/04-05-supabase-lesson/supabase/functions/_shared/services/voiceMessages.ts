// Голосовые гостя в админке (S09, сессия 4): прослушивание и распознавание по кнопке менеджера. Вызывает Edge
// Function manager-chat. Про Telegram не знает (ADR-008): скачивание файла по file_id даёт обработчик (download).
// Два клиента, как в managerChat.ts: userClient (JWT менеджера) — чтение сообщения, RLS проверяет ресторан;
// serviceClient — запись расшифровки (у менеджера нет права update на messages).
import type { SupabaseClient } from "@supabase/supabase-js";
import { canTranscribeFile, VOICE_PLACEHOLDER } from "../domain/voice.ts";
import type { LlmClient } from "../llm/types.ts";
import { getMessageById, updateMessageTextAndMeta } from "../repositories/messagesRepo.ts";
import type { VoiceMeta } from "../types.ts";
import { transcribeAudio } from "./ai/voice.ts";

/** Байты файла по file_id или null — Telegram не отдал (файл удалён, слишком большой, сбой сети). */
export type DownloadFile = (fileId: string) => Promise<Uint8Array | null>;

export interface VoiceMessageDeps {
  userClient: SupabaseClient;
  download: DownloadFile;
}

type FoundVoice =
  | { error: "not_found" | "not_voice" }
  | { error?: never; row: { id: string; text: string }; voice: VoiceMeta };

/** Голосовое сообщение, доступное менеджеру: строка из журнала с meta.voice. */
async function findVoice(userClient: SupabaseClient, messageId: string): Promise<FoundVoice> {
  const row = await getMessageById(userClient, messageId);
  if (!row) return { error: "not_found" };
  const voice = row.meta?.voice as VoiceMeta | undefined;
  if (!voice?.fileId) return { error: "not_voice" };
  return { row, voice };
}

export type VoiceAudioResult =
  | { ok: true; bytes: Uint8Array; mimeType: string }
  | { ok: false; error: "not_found" | "not_voice" | "unavailable" };

/** Звук голосового для плеера. unavailable — Telegram файл не отдал: менеджер увидит «аудио недоступно». */
export async function getVoiceAudio(deps: VoiceMessageDeps, messageId: string): Promise<VoiceAudioResult> {
  const found = await findVoice(deps.userClient, messageId);
  if (found.error) return { ok: false, error: found.error };
  const bytes = await deps.download(found.voice.fileId);
  if (!bytes) return { ok: false, error: "unavailable" };
  return { ok: true, bytes, mimeType: found.voice.mimeType ?? "audio/ogg" };
}

export type TranscribeVoiceResult =
  | { ok: true; text: string }
  | { ok: false; error: "not_found" | "not_voice" | "ai_unavailable" | "too_big" | "unavailable" | "unclear" | "failed" };

/**
 * Распознать голосовое по кнопке менеджера. Работает при любом ai_enabled: это явное действие менеджера, нужен только
 * настроенный Gemini (llm = null — ai_unavailable). Уже распознанное не распознаём повторно — отдаём текст.
 * Итог пишется в сообщение: текст вместо заглушки (агент после возврата диалога увидит, что сказал гость) и
 * расход в meta.voice — он оплачен и при «не разобрать», статистика его учитывает.
 */
export async function transcribeVoiceMessage(
  deps: VoiceMessageDeps & { serviceClient: SupabaseClient; llm: LlmClient | null },
  messageId: string,
): Promise<TranscribeVoiceResult> {
  const found = await findVoice(deps.userClient, messageId);
  if (found.error) return { ok: false, error: found.error };
  const { row, voice } = found;
  // Двойной клик или вторая вкладка: текст уже есть — модель не зовём.
  if (voice.transcribedBy) return { ok: true, text: row.text };
  if (!deps.llm) return { ok: false, error: "ai_unavailable" };
  if (!canTranscribeFile(voice.fileSize)) return { ok: false, error: "too_big" };

  const bytes = await deps.download(voice.fileId);
  if (!bytes) return { ok: false, error: "unavailable" };
  const outcome = await transcribeAudio(deps.llm, { bytes, mimeType: voice.mimeType });

  // Прежняя ошибка (например, автоматического распознавания) заменяется итогом этой попытки.
  const { transcribeError: _previous, ...rest } = voice;
  const nextVoice: VoiceMeta = outcome.text
    ? { ...rest, ...outcome.meta, transcribedBy: "manager" }
    : { ...rest, ...outcome.meta };
  await updateMessageTextAndMeta(deps.serviceClient, row.id, outcome.text ?? VOICE_PLACEHOLDER, { voice: nextVoice });

  if (outcome.text) return { ok: true, text: outcome.text };
  return { ok: false, error: outcome.meta.transcribeError === "unclear" ? "unclear" : "failed" };
}
