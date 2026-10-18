// Интеграционный тест S06d против dev-БД: RPC set_last_nav и set_faq_answer.
// Запуск: deno test --allow-env --allow-net --allow-read --env-file=../../.env _shared/services/navigation.integration.test.ts
// Без SUPABASE_URL пропускается. Нужна применённая миграция S06d. Создаёт диалог с отрицательным external_user_id
// и удаляет его.
import { assertEquals } from "jsr:@std/assert@1";
import { casFaqAnswer, casLastNav } from "../repositories/conversationsRepo.ts";
import { createServiceClient } from "../supabaseClient.ts";

const url = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const enabled = !!url && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !enabled };

async function withConversation(fn: (client: ReturnType<typeof createServiceClient>, id: string) => Promise<void>) {
  const client = createServiceClient();
  const { data: restaurant } = await client.from("restaurants").select("id").limit(1).single();
  const { data, error } = await client.from("conversations").insert({
    restaurant_id: restaurant!.id,
    channel: "telegram",
    external_user_id: -Math.floor(Math.random() * 1_000_000_000) - 20_000,
    chat_id: -1,
    display_name: "nav-test",
  }).select("id").single();
  if (error) throw error;
  try {
    await fn(client, data!.id);
  } finally {
    await client.from("conversations").delete().eq("id", data!.id);
  }
}

Deno.test({
  name: "set_last_nav: expected совпал — пишет, не совпал — нет; faq_answer_id сохраняется",
  ...opts,
  async fn() {
    await withConversation(async (client, id) => {
      assertEquals(await casLastNav(client, { conversationId: id, expected: 5, screen: "menu", messageId: 10 }), false);
      assertEquals(await casLastNav(client, { conversationId: id, expected: null, screen: "menu", messageId: 10 }), true);
      assertEquals(await casLastNav(client, { conversationId: id, expected: null, screen: "info", messageId: 11 }), false);

      await casFaqAnswer(client, { conversationId: id, expected: null, messageId: 77 });
      assertEquals(await casLastNav(client, { conversationId: id, expected: 10, screen: "info", messageId: 11 }), true);
      const { data } = await client.from("conversations").select("last_nav").eq("id", id).single();
      const nav = data!.last_nav as Record<string, unknown>;
      assertEquals([nav.screen, nav.message_id, nav.faq_answer_id], ["info", 11, 77]);
    });
  },
});

Deno.test({
  name: "set_last_nav: параллельные вызовы с одним expected — выигрывает один",
  ...opts,
  async fn() {
    await withConversation(async (client, id) => {
      const got = await Promise.all(
        Array.from({ length: 6 }, (_, i) => casLastNav(client, { conversationId: id, expected: null, screen: "menu", messageId: 100 + i })),
      );
      assertEquals(got.filter(Boolean).length, 1);
    });
  },
});

Deno.test({
  name: "set_faq_answer: прежний ответ возвращается, несовпадение expected — swapped = false",
  ...opts,
  async fn() {
    await withConversation(async (client, id) => {
      assertEquals(await casFaqAnswer(client, { conversationId: id, expected: null, messageId: 1 }), { swapped: true, previousId: null });
      assertEquals(await casFaqAnswer(client, { conversationId: id, expected: null, messageId: 2 }), { swapped: false, previousId: 1 });
      assertEquals(await casFaqAnswer(client, { conversationId: id, expected: 1, messageId: 2 }), { swapped: true, previousId: 1 });
    });
  },
});

Deno.test({
  name: "set_faq_answer: параллельные вызовы — выигрывает один",
  ...opts,
  async fn() {
    await withConversation(async (client, id) => {
      const got = await Promise.all(
        Array.from({ length: 6 }, (_, i) => casFaqAnswer(client, { conversationId: id, expected: null, messageId: 200 + i })),
      );
      assertEquals(got.filter((r) => r.swapped).length, 1);
    });
  },
});

Deno.test({
  name: "set_last_nav и set_faq_answer недоступны клиентам с публичным ключом",
  ...opts,
  ignore: !enabled || !anonKey,
  async fn() {
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const anon = createClient(url!, anonKey!);
    const nav = await anon.rpc("set_last_nav", {
      p_conversation_id: "00000000-0000-0000-0000-000000000000",
      p_expected: null,
      p_screen: "menu",
      p_message_id: 1,
    });
    const faq = await anon.rpc("set_faq_answer", {
      p_conversation_id: "00000000-0000-0000-0000-000000000000",
      p_expected: null,
      p_new: 1,
    });
    assertEquals(!!nav.error, true);
    assertEquals(!!faq.error, true);
  },
});
