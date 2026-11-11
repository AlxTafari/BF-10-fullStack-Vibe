import { type KeyboardEvent, useEffect, useState } from "react";
import { useJoinChatMutation, useLeaveChatMutation, useSendManagerReplyMutation } from "@/api/chatApi";
import type { ApiError } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatTimeHM } from "@/domain/chatTime";
import {
  MANAGER_REPLY_COUNTER_FROM,
  MANAGER_REPLY_MAX_LENGTH,
  deliveryError,
  isHandoffActive,
  joinWarning,
} from "@/domain/handoff";

// Менеджер в диалоге (S06b): плашка ручного режима в шапке и низ ленты (кнопка «Подключиться» или поле ввода).

/**
 * Идёт ли ручной режим — с перерисовкой в момент истечения. Событий об истечении нет (тайм-аут ленивый, на сервере
 * метка просто устаревает), поэтому ставим таймер на handoff_until: плашка и поле прячутся сами.
 * «Сейчас» хранится в состоянии и обновляется только таймером: Date.now() прямо в рендере нечист (react-hooks/purity).
 */
export function useHandoffActive(handoffUntil: string | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!handoffUntil) return;
    const until = Date.parse(handoffUntil);
    if (!Number.isFinite(until)) return;
    // Уже истекла (устаревшее «сейчас» в состоянии) — обновить сразу; иначе — после метки. +50 мс: перерисоваться
    // уже после неё, а не за миг до (иначе режим останется активным).
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [handoffUntil]);
  return isHandoffActive(handoffUntil, now);
}

const errorText = (error: unknown) => (error as ApiError | undefined)?.message ?? "Не удалось выполнить, попробуйте ещё раз";

/** Плашка «Вы в чате» с кнопкой «Отключиться». Показывается, пока идёт ручной режим. */
export function HandoffBanner({ conversationId, handoffUntil, timeZone }: { conversationId: string; handoffUntil: string; timeZone: string }) {
  const [leave, { isLoading, error }] = useLeaveChatMutation();
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-emerald-600/30 bg-emerald-600/10 px-4 py-2 text-sm">
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-emerald-700 dark:text-emerald-400">Вы в чате</span> · бот на паузе до {formatTimeHM(handoffUntil, timeZone)}
        {error && <span role="alert" className="block text-destructive">{errorText(error)}</span>}
      </p>
      <Button size="sm" variant="outline" disabled={isLoading} onClick={() => void leave(conversationId)}>
        {isLoading ? "Отключаемся…" : "Отключиться"}
      </Button>
    </div>
  );
}

/**
 * Низ ленты. Режима нет — цветная кнопка «Подключиться к чату» (писать без неё нельзя: защита от случайной отправки).
 * Режим идёт — поле ввода. Черновик живёт в этом компоненте и переживает истечение режима: менеджер подключится
 * снова и отправит тот же текст.
 */
export function ManagerComposer({ conversationId, active }: { conversationId: string; active: boolean }) {
  const [text, setText] = useState("");
  const [join, joinState] = useJoinChatMutation();
  const [send, sendState] = useSendManagerReplyMutation();
  // Итог последней отправки или подключения, который не ошибка запроса: «не доставлено», «гость заблокировал бота».
  const [notice, setNotice] = useState<string | null>(null);

  const onJoin = async () => {
    setNotice(null);
    sendState.reset(); // «подключение истекло» от прошлой отправки после нового подключения уже неправда
    const result = await join(conversationId);
    if ("data" in result && result.data) setNotice(joinWarning(result.data.delivery));
  };

  const trimmed = text.trim();
  const tooLong = trimmed.length > MANAGER_REPLY_MAX_LENGTH;
  const canSend = active && trimmed.length > 0 && !tooLong && !sendState.isLoading;

  const onSend = async () => {
    if (!canSend) return;
    setNotice(null);
    const result = await send({ conversationId, text: trimmed });
    if (!("data" in result) || !result.data) return; // ошибка запроса — текст остаётся, причина в sendState.error
    const data = result.data;
    if (data.delivery !== "sent") {
      setNotice(deliveryError(data.delivery)); // недоставленное в историю не пишется — текст остаётся в поле
      return;
    }
    setText("");
    if (!data.recorded) setNotice("Доставлено, но не сохранилось в истории");
  };

  // Enter — отправить, Shift+Enter — перенос строки. isComposing: Enter, подтверждающий ввод IME, не отправляет.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void onSend();
    }
  };

  if (!active) {
    return (
      <div className="space-y-1 border-t px-4 py-3 text-center">
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={joinState.isLoading} onClick={() => void onJoin()}>
          {joinState.isLoading ? "Подключаемся…" : "Подключиться к чату"}
        </Button>
        <p className="text-xs text-muted-foreground">Гостю придёт уведомление, AI-помощник замолчит</p>
        {joinState.error && <p role="alert" className="text-xs text-destructive">{errorText(joinState.error)}</p>}
        {/* Отправка упала с «подключение истекло» — кнопка уже здесь, причину показываем рядом. */}
        {sendState.error && <p role="alert" className="text-xs text-destructive">{errorText(sendState.error)}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1 border-t px-4 py-3">
      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sendState.isLoading}
          placeholder="Сообщение гостю — придёт с подписью «Менеджер ресторана»"
          aria-label="Сообщение гостю"
          aria-invalid={tooLong || undefined}
          className="max-h-40 min-h-10 resize-none"
        />
        <Button disabled={!canSend} onClick={() => void onSend()}>
          {sendState.isLoading ? "Отправка…" : "Отправить"}
        </Button>
      </div>
      <div className="flex justify-between gap-2 text-xs">
        <span role="alert" className="text-destructive">
          {notice ?? (sendState.error ? errorText(sendState.error) : null)}
        </span>
        {trimmed.length >= MANAGER_REPLY_COUNTER_FROM && (
          <span className={tooLong ? "text-destructive" : "text-muted-foreground"}>
            {trimmed.length} / {MANAGER_REPLY_MAX_LENGTH}
          </span>
        )}
      </div>
    </div>
  );
}
