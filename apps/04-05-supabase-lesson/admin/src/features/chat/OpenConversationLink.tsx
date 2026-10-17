import { Link } from "@tanstack/react-router";

/**
 * «Открыть диалог» из карточки заявки. conversation_id = null (диалог удалён) — ссылки нет:
 * вести некуда, а мёртвая кнопка выглядела бы поломкой.
 */
export function OpenConversationLink({ conversationId }: { conversationId: string | null }) {
  if (!conversationId) return null;
  return (
    <Link
      to="/chats/$conversationId"
      params={{ conversationId }}
      className="inline-block text-sm underline underline-offset-2"
    >
      Открыть диалог
    </Link>
  );
}
