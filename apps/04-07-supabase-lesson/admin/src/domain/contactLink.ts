// Контакт гостя → ссылка. Контакт — недоверенный ввод: ссылку строим только по строгим шаблонам
// (те же, что при вводе в боте, supabase/functions/_shared/domain/fieldValidation.ts), всё остальное — простой текст.
// Никогда не подставляем сырую строку в href: `javascript:` и подобное сюда не пройдёт.

export interface ContactLink {
  kind: "telegram" | "phone";
  href: string;
}

const TELEGRAM_RE = /^@([A-Za-z0-9_]{5,32})$/;
const PHONE_RE = /^\+?\d{10,15}$/;

export function contactLink(contact: string): ContactLink | null {
  const raw = contact.trim();
  const tg = TELEGRAM_RE.exec(raw);
  if (tg) return { kind: "telegram", href: `https://t.me/${tg[1]}` };
  const phone = raw.replace(/[\s()-]/g, "");
  if (PHONE_RE.test(phone)) return { kind: "phone", href: `tel:${phone}` };
  return null;
}
