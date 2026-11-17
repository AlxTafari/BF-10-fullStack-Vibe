// Звук новой заявки. Браузер не даёт играть звук, пока человек не кликнул по странице (autoplay policy),
// поэтому AudioContext создаётся и «размораживается» по клику на кнопку «Звук». Сигнал синтезируется — файл не нужен.
// Настройка «включён» — в localStorage; он может быть недоступен (приватное окно), страница работает и без него.

const STORAGE_KEY = "notifySoundEnabled";

let context: AudioContext | null = null;

export function loadSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // нет хранилища — настройка просто не переживёт перезагрузку
  }
}

/** Вызывать из обработчика пользовательского действия. true — звук готов играть. */
export function unlockAudio(): boolean {
  try {
    context ??= new AudioContext();
    void context.resume();
    return context.state === "running";
  } catch {
    return false;
  }
}

export function isAudioUnlocked(): boolean {
  return context?.state === "running";
}

/** Два коротких тона. Без разблокированного контекста молча ничего не делает. */
export function playNotifySound(): void {
  if (!context || context.state !== "running") return;
  const ctx = context;
  const start = ctx.currentTime;
  [660, 880].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + i * 0.18;
    // короткая огибающая: без щелчка в начале и конце
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  });
}
