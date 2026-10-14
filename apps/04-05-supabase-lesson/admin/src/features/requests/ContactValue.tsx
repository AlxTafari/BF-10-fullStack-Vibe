import { contactLink } from "@/domain/contactLink";

/**
 * Контакт гостя. Ссылка — только для строго распознанных @username и телефона (domain/contactLink),
 * всё остальное — простой текст. Контакт вводит гость: это недоверенные данные.
 */
export function ContactValue({ contact }: { contact: string | null }) {
  if (!contact) return <span className="text-muted-foreground">контакт не указан</span>;
  const link = contactLink(contact);
  if (!link) return <span className="break-words">{contact}</span>;
  return (
    <a
      href={link.href}
      {...(link.kind === "telegram" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="break-words text-primary underline underline-offset-2"
      onClick={(e) => e.stopPropagation()} // клик по контакту в строке списка не должен открывать карточку
    >
      {contact}
    </a>
  );
}
