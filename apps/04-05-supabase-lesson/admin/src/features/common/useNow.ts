import { useEffect, useState } from "react";

/** Текущее время, обновляемое раз в `everyMs`: «5 мин назад» и метки «время прошло» не застывают на экране. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
