import { cn } from "@/lib/utils";
import { type Message, buttonData, classifyMessage } from "@/domain/messages";
import { formatTimeHM } from "@/domain/chatTime";

/**
 * Одно сообщение. Текст гостя — НЕДОВЕРЕННЫЙ: выводим только как текст через React (экранирование), без
 * dangerouslySetInnerHTML и без автоссылок; HTML-подобные строки показываются буквально (инвариант 7).
 */
export function MessageItem({ message, timeZone }: { message: Message; timeZone: string }) {
  if (classifyMessage(message) === "button") {
    // Нажатия кнопок интересны как факт («что гость нажимал»), но не как реплики: сырой callback_data — в подсказке.
    return (
      <p className="py-0.5 text-center text-xs text-muted-foreground" title={buttonData(message)}>
        Нажата кнопка · {formatTimeHM(message.created_at, timeZone)}
      </p>
    );
  }

  const fromGuest = message.direction === "in";
  // Поиск по меню: тот же пузырь, но приглушённый и с подписью — шум, который менеджеру виден, не кричит.
  const isSearch = classifyMessage(message) === "search";
  return (
    <div className={cn("flex", fromGuest ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
          isSearch
            ? "border border-dashed bg-transparent text-muted-foreground"
            : fromGuest
              ? "bg-muted"
              : "bg-primary text-primary-foreground",
        )}
      >
        {isSearch && <p className="mb-1 text-[10px] uppercase tracking-wide">Поиск по меню</p>}
        {/* pre-wrap: боты пишут многострочно; break-words: длинное слово без пробелов не ломает вёрстку */}
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.text}</p>
        <p className={cn("mt-1 text-right text-[10px]", fromGuest || isSearch ? "text-muted-foreground" : "text-primary-foreground/70")}>
          {formatTimeHM(message.created_at, timeZone)}
        </p>
      </div>
    </div>
  );
}
