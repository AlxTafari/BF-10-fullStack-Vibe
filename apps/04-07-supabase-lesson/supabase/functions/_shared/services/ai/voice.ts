// Распознавание голосового (S09, сессия 4). Про Telegram не знает (ADR-008): байты файла скачивает обработчик —
// бот в handlers/voice.ts, менеджер в manager-chat. Здесь — вызов модели и разбор ответа.
import { normalizeTranscript, TRANSCRIBE_INSTRUCTION } from "../../domain/voice.ts";
import { type LlmClient, LlmError } from "../../llm/types.ts";
import type { VoiceMeta } from "../../types.ts";

/**
 * Предел одного распознавания. Минута аудио у Gemini — несколько секунд; 20 с — как у вызова агента (LLM_CALL_TIMEOUT_MS).
 * Ход агента после распознавания укладывается в свой бюджет (TURN_TIMEOUT_MS) отдельно.
 */
export const TRANSCRIBE_TIMEOUT_MS = 20_000;

/** Голосовые Telegram — OGG/Opus; mime_type в апдейте бывает не указан. */
const DEFAULT_VOICE_MIME = "audio/ogg";

/**
 * Итог распознавания. text = null — не вышло (причина в meta.transcribeError). meta — поля для VoiceMeta: модель,
 * расход (если модель ответила — токены оплачены и при неудаче) и причина сбоя. transcribedBy ставит вызывающий.
 */
export interface TranscribeOutcome {
  text: string | null;
  meta: Partial<VoiceMeta>;
}

/** Не бросает: любой сбой модели — text = null с классом сбоя. Гостю или менеджеру решает, что сказать, вызывающий. */
export async function transcribeAudio(llm: LlmClient, audio: { bytes: Uint8Array; mimeType?: string }): Promise<TranscribeOutcome> {
  const startedAt = Date.now();
  try {
    const result = await llm.transcribe({
      system: TRANSCRIBE_INSTRUCTION,
      audio: audio.bytes,
      mimeType: audio.mimeType ?? DEFAULT_VOICE_MIME,
      timeoutMs: TRANSCRIBE_TIMEOUT_MS,
    });
    const usage = {
      model: llm.model,
      calls: 1,
      inputTokens: result.usage?.input ?? 0,
      outputTokens: result.usage?.output ?? 0,
      thoughtTokens: result.usage?.thoughts ?? 0,
      ms: Date.now() - startedAt,
    };
    const text = normalizeTranscript(result);
    return text ? { text, meta: usage } : { text: null, meta: { ...usage, transcribeError: "unclear" } };
  } catch (error) {
    // Сбой модели: токены, если и потрачены, провайдер не вернул — расхода нет, только класс сбоя.
    const kind = error instanceof LlmError ? error.kind : "unavailable";
    // В лог — только класс: в тексте ошибки SDK может быть кусок запроса (см. gemini.ts).
    console.error("transcribe failed:", kind);
    return { text: null, meta: { model: llm.model, transcribeError: kind } };
  }
}
