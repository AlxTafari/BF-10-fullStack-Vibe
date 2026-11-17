import { useCallback, useEffect, useState } from "react";
import { isAudioUnlocked, loadSoundEnabled, playNotifySound, saveSoundEnabled, unlockAudio } from "./notifySound";

export interface NotifySound {
  /** Менеджер включил звук. */
  enabled: boolean;
  /** Звук включён, но браузер ещё не разрешил (после перезагрузки страницы): нужен любой клик. */
  waitingForClick: boolean;
  /** Клик по кнопке: включить → (если ждёт клика — разморозить) → выключить. */
  toggle: () => void;
  play: () => void;
}

export function useNotifySound(): NotifySound {
  const [enabled, setEnabled] = useState(loadSoundEnabled);
  const [unlocked, setUnlocked] = useState(isAudioUnlocked);

  // Звук был включён в прошлый раз: первый же клик где угодно на странице разморозит аудио.
  useEffect(() => {
    if (!enabled || unlocked) return;
    const onPointer = () => setUnlocked(unlockAudio());
    window.addEventListener("pointerdown", onPointer, { once: true });
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [enabled, unlocked]);

  const toggle = useCallback(() => {
    if (!enabled) {
      setUnlocked(unlockAudio());
      setEnabled(true);
      saveSoundEnabled(true);
      playNotifySound(); // пробный сигнал: менеджер сразу слышит, что включилось
    } else if (!unlocked) {
      setUnlocked(unlockAudio());
    } else {
      setEnabled(false);
      saveSoundEnabled(false);
    }
  }, [enabled, unlocked]);

  const play = useCallback(() => {
    if (enabled) playNotifySound();
  }, [enabled]);

  return { enabled, waitingForClick: enabled && !unlocked, toggle, play };
}
