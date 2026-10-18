// Интеграционный тест антиспама (S06c) против dev-БД: RPC check_rate_limit.
// Запуск: deno test --allow-env --allow-net --allow-read --env-file=../../.env _shared/services/antispam.integration.test.ts
// Без SUPABASE_URL тест пропускается. Нужна применённая миграция S06c. Создаёт строки с отрицательным
// external_user_id (не пересекается с настоящими Telegram id) и удаляет их.
import { assertEquals } from "jsr:@std/assert@1";
import { checkRateLimit } from "../repositories/rateLimitsRepo.ts";
import { createServiceClient } from "../supabaseClient.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const randomUser = () => -Math.floor(Math.random() * 1_000_000_000) - 10_000;
const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !enabled };

Deno.test({
  name: "check_rate_limit: 3 пропущены, одно предупреждение, дальше drop",
  ...opts,
  async fn() {
    const client = createServiceClient();
    const externalUserId = randomUser();
    try {
      const got: unknown[] = [];
      for (let i = 0; i < 6; i++) got.push(await checkRateLimit(client, { externalUserId, max: 3, windowSeconds: 30 }));
      assertEquals(got, ["allowed", "allowed", "allowed", "warn", "drop", "drop"]);
    } finally {
      await client.from("rate_limits").delete().eq("external_user_id", externalUserId);
    }
  },
});

Deno.test({
  name: "check_rate_limit: параллельные вызовы (двойной тап) не обходят лимит и дают одно предупреждение",
  ...opts,
  async fn() {
    const client = createServiceClient();
    const externalUserId = randomUser();
    try {
      const got = await Promise.all(
        Array.from({ length: 8 }, () => checkRateLimit(client, { externalUserId, max: 3, windowSeconds: 30 })),
      );
      assertEquals(got.filter((d) => d === "allowed").length, 3);
      assertEquals(got.filter((d) => d === "warn").length, 1);
      assertEquals(got.filter((d) => d === "drop").length, 4);
    } finally {
      await client.from("rate_limits").delete().eq("external_user_id", externalUserId);
    }
  },
});

Deno.test({
  name: "check_rate_limit: новое окно сбрасывает счётчик и флаг предупреждения",
  ...opts,
  async fn() {
    const client = createServiceClient();
    const externalUserId = randomUser();
    try {
      // Окно 1 секунда: превышаем, ждём, и гость снова проходит; после нового превышения — снова одно warn.
      for (let i = 0; i < 4; i++) await checkRateLimit(client, { externalUserId, max: 3, windowSeconds: 1 });
      await new Promise((resolve) => setTimeout(resolve, 1300));
      const got: unknown[] = [];
      for (let i = 0; i < 4; i++) got.push(await checkRateLimit(client, { externalUserId, max: 3, windowSeconds: 1 }));
      assertEquals(got, ["allowed", "allowed", "allowed", "warn"]);
    } finally {
      await client.from("rate_limits").delete().eq("external_user_id", externalUserId);
    }
  },
});

Deno.test({
  name: "rate_limits и check_rate_limit недоступны клиентам с публичным ключом",
  ...opts,
  async fn() {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!anonKey) return; // ключа нет в окружении — проверка пропущена
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const anon = createClient(url, anonKey);
    const rpc = await anon.rpc("check_rate_limit", { p_external_user_id: -1, p_max: 3, p_window_seconds: 30 });
    assertEquals(rpc.error !== null, true);
    const table = await anon.from("rate_limits").select("*");
    assertEquals((table.data ?? []).length, 0);
  },
});
