import { skipToken } from "@reduxjs/toolkit/query";
import { useState } from "react";
import { useGetVoiceAudioQuery, useTranscribeVoiceMutation } from "@/api/chatApi";
import type { ApiError } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { type Message, type VoiceInfo, formatVoiceDuration } from "@/domain/messages";

const errorText = (error: unknown) => (error as ApiError | undefined)?.message ?? "Не удалось выполнить, попробуйте ещё раз";

/** Почему прошлое распознавание не дало текста — коротко, под кнопкой «Распознать». */
function previousErrorText(error: string): string {
  return error === "unclear" ? "Прошлая попытка: речь не разобрать" : "Прошлая попытка распознать не удалась";
}

/**
 * Голосовое гостя внутри пузыря (S09, сессия 4): длительность, плеер по клику и расшифровка — или кнопка «Распознать».
 * Расшифровка — текст гостя, НЕДОВЕРЕННЫЙ: выводим только как текст через React, как любую реплику (инвариант 7).
 */
export function VoiceContent({ message, voice }: { message: Message; voice: VoiceInfo }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">🎤 Голосовое · {formatVoiceDuration(voice.duration)}</p>
      <VoicePlayer messageId={message.id} />
      {voice.transcribedBy ? (
        <>
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.text}</p>
          <p className="text-[10px] text-muted-foreground">
            {voice.transcribedBy === "auto" ? "Распознано для AI-помощника" : "Распознано по кнопке"}
          </p>
        </>
      ) : (
        <TranscribeButton message={message} voice={voice} />
      )}
    </div>
  );
}

/**
 * Звук грузится только по клику: каждое прослушивание — скачивание у Telegram через Edge Function. Плееру нужен
 * `media-src blob:` в CSP (vite.config.ts). Если браузер всё же не смог (формат, политика) — ссылка «Скачать»,
 * файл откроется в плеере системы.
 */
function VoicePlayer({ messageId }: { messageId: string }) {
  const [requested, setRequested] = useState(false);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const audio = useGetVoiceAudioQuery(requested ? messageId : skipToken);

  if (!requested) {
    return (
      <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setRequested(true)}>
        ▶ Прослушать
      </Button>
    );
  }
  if (audio.error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {errorText(audio.error)}{" "}
        <button type="button" className="underline underline-offset-2" onClick={() => void audio.refetch()}>
          Повторить
        </button>
      </p>
    );
  }
  if (!audio.data) return <p className="text-xs text-muted-foreground">Загружаю аудио…</p>;
  return (
    <div className="space-y-1">
      <audio controls autoPlay src={audio.data} className="h-8 w-64 max-w-full" onError={() => setPlaybackFailed(true)} />
      {playbackFailed && (
        <p className="text-xs text-muted-foreground">
          Браузер не смог воспроизвести аудио.{" "}
          <a className="underline underline-offset-2" href={audio.data} download={`voice-${messageId}.ogg`}>
            Скачать
          </a>
        </p>
      )}
    </div>
  );
}

/** «Распознать»: результат подставляется в ленту (chatApi.transcribeVoice); повторное нажатие сервер не перераспознаёт. */
function TranscribeButton({ message, voice }: { message: Message; voice: VoiceInfo }) {
  const [transcribe, state] = useTranscribeVoiceMutation();
  return (
    <div className="space-y-1">
      {voice.error && !state.error && <p className="text-[10px] text-muted-foreground">{previousErrorText(voice.error)}</p>}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        disabled={state.isLoading}
        onClick={() => void transcribe({ messageId: message.id, conversationId: message.conversation_id })}
      >
        {state.isLoading ? "Распознаю…" : "Распознать"}
      </Button>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {errorText(state.error)}
        </p>
      )}
    </div>
  );
}
