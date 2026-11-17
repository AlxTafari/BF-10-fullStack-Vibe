/** Сравнение без раннего выхода по первому несовпавшему символу (секрет не подбирается по времени ответа). */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** notify-guest вызывает триггер БД (pg_net) с общим секретом в заголовке; Supabase JWT тут нет (verify_jwt = false). */
export function isValidNotifySecret(req: Request): boolean {
  const expected = Deno.env.get("NOTIFY_GUEST_SECRET");
  if (!expected) return false;
  const received = req.headers.get("x-notify-secret");
  return received !== null && safeEqual(received, expected);
}
