// Проверка полей заявки. Одни и те же функции зовёт сценарий (на вводе) и сервис (на записи):
// сервис станет tool'ом для LLM (ADR-004), поэтому на него нельзя полагаться «сценарий уже проверил».

export type FieldError =
  | "guests_not_integer"
  | "guests_too_few"
  | "guests_too_many"
  | "name_too_short"
  | "name_too_long"
  | "contact_invalid"
  | "comment_too_long"
  | "text_empty"
  | "text_too_long";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: FieldError };

export const GUESTS_MAX = 20;
export const NAME_MIN = 2;
export const NAME_MAX = 60;
export const COMMENT_MAX = 500;
export const REQUEST_TEXT_MAX = 2000;

export function validateGuests(input: string | number): Validated<number> {
  const raw = typeof input === "number" ? String(input) : input.trim();
  // Только цифры: «4.5», «-3», «4 человека» — не целое число гостей.
  if (!/^\d+$/.test(raw)) return { ok: false, error: "guests_not_integer" };
  const n = Number(raw);
  if (n < 1) return { ok: false, error: "guests_too_few" };
  if (n > GUESTS_MAX) return { ok: false, error: "guests_too_many" };
  return { ok: true, value: n };
}

export function validateName(input: string): Validated<string> {
  const name = input.trim();
  if (name.length < NAME_MIN) return { ok: false, error: "name_too_short" };
  if (name.length > NAME_MAX) return { ok: false, error: "name_too_long" };
  return { ok: true, value: name };
}

/** Телефон (10–15 цифр) или @username (5–32 символа). Телефон нормализуем: «+», затем цифры. */
export function validateContact(input: string): Validated<string> {
  const raw = input.trim();
  if (/^@[A-Za-z0-9_]{5,32}$/.test(raw)) return { ok: true, value: raw };
  // Разрешённые «украшения» телефона убираем; любой другой символ (буквы) — не телефон.
  const stripped = raw.replace(/[\s()\-]/g, "");
  if (/^\+?\d{10,15}$/.test(stripped)) return { ok: true, value: stripped };
  return { ok: false, error: "contact_invalid" };
}

/** Пустой комментарий = его нет: возвращаем null, не пустую строку. */
export function validateComment(input: string): Validated<string | null> {
  const comment = input.trim();
  if (comment.length > COMMENT_MAX) return { ok: false, error: "comment_too_long" };
  return { ok: true, value: comment === "" ? null : comment };
}

export function validateRequestText(input: string): Validated<string> {
  const text = input.trim();
  if (text.length === 0) return { ok: false, error: "text_empty" };
  if (text.length > REQUEST_TEXT_MAX) return { ok: false, error: "text_too_long" };
  return { ok: true, value: text };
}
