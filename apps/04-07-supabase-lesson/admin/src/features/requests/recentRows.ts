import { useSyncExternalStore } from "react";

// Строки, появившиеся по событию Realtime, подсвечиваются на несколько секунд.
// Маленькое внешнее хранилище вне React: событие приходит из канала, а читают строки списков.

const HIGHLIGHT_MS = 6_000;

let ids: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function markRecent(id: string): void {
  ids = new Set(ids).add(id);
  emit();
  setTimeout(() => {
    const next = new Set(ids);
    next.delete(id);
    ids = next;
    emit();
  }, HIGHLIGHT_MS);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useIsRecent(id: string): boolean {
  return useSyncExternalStore(subscribe, () => ids.has(id));
}
