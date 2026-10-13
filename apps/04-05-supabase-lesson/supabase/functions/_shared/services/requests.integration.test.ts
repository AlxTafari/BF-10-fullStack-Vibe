// Интеграционный тест идемпотентности заявок (ADR-006) против dev-БД.
// Запуск: deno test --allow-env --allow-net --allow-read --env-file=../../.env _shared/services/requests.integration.test.ts
// Без SUPABASE_URL тест пропускается. Создаёт свои строки (диалог с отрицательным external_user_id) и удаляет их.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { availableDates } from "../domain/bookingRules.ts";
import { upsertConversation } from "../repositories/conversationsRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import { createServiceClient } from "../supabaseClient.ts";
import { createBookingRequest } from "./bookingRequests.ts";
import type { BookingState } from "../domain/flowState.ts";
import { createGuestRequest } from "./guestRequests.ts";
import { isDraftSubmitted, saveFlowState, submitFlow } from "./flow.ts";

const enabled = !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.test({
  name: "заявки: повтор с тем же draftId не создаёт дубль",
  ignore: !enabled,
  // supabase-js держит соединения; тест сам ничего не оставляет открытым.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const client = createServiceClient();
    const restaurant = await getRestaurant(client);
    assert(restaurant, "в dev-БД нет ресторана — запусти seed");

    // Тестовый гость: отрицательный id не пересекается с настоящими пользователями Telegram.
    const conversation = await upsertConversation(client, {
      restaurantId: restaurant.id,
      externalUserId: -Math.floor(Math.random() * 1_000_000_000) - 1,
      chatId: -1,
      displayName: "integration-test",
    });

    try {
      // Ближайшая дата, на которую ресторан принимает бронь (учитывает часы работы и выходной).
      const dates = availableDates({
        now: new Date(),
        timeZone: restaurant.timezone,
        openingHours: restaurant.opening_hours,
      });
      const date = dates.at(-1);
      assert(date, "нет доступных дат для брони");

      const booking = (draftId: string) =>
        createBookingRequest(client, {
          conversationId: conversation.id,
          draftId,
          date,
          time: "19:00",
          guests: 4,
          name: "Тест",
          contact: "@integration_test",
          comment: null,
        });

      // 1. Первое нажатие «Отправить» создаёт заявку, повторное — возвращает ту же.
      const draft = crypto.randomUUID();
      const first = await booking(draft);
      assert(first.ok);
      assertEquals(first.created, true);
      assertEquals(first.request.status, "pending");
      assertEquals(first.request.manager_notified_at, null);

      const second = await booking(draft);
      assert(second.ok);
      assertEquals(second.created, false);
      assertEquals(second.request.id, first.request.id);

      // 2. Двойной тап = две параллельные обработки одного draftId: ровно одна создаёт.
      const racing = crypto.randomUUID();
      const results = await Promise.all([booking(racing), booking(racing)]);
      assert(results.every((r) => r.ok));
      const createdCount = results.filter((r) => r.ok && r.created).length;
      assertEquals(createdCount, 1);
      const ids = new Set(results.map((r) => r.ok && r.request.id));
      assertEquals(ids.size, 1);

      // 2а. Двойной тап «Отправить» через сценарий: заявка одна, гостю отвечает ровно один обработчик,
      // и после отправки повторное нажатие распознаётся как «уже отправлено» (бот молчит).
      const draftId = crypto.randomUUID();
      const state: BookingState = {
        flow: "booking",
        step: "confirm",
        draftId,
        touchedAt: new Date().toISOString(),
        data: { date, period: "dinner", time: "19:00", guests: 2, name: "Тест", contact: "@integration_test", comment: null },
      };
      await saveFlowState(client, conversation.id, state);
      assertEquals(await isDraftSubmitted(client, conversation.id, draftId), false);
      const taps = await Promise.all([
        submitFlow(client, conversation.id, state),
        submitFlow(client, conversation.id, state),
        submitFlow(client, conversation.id, state),
      ]);
      assert(taps.every((t) => t.ok));
      assertEquals(taps.filter((t) => t.ok && t.created).length, 1); // уведомление менеджеру — одно
      assertEquals(taps.filter((t) => t.ok && t.claimed).length, 1); // ответ гостю — один
      assertEquals(new Set(taps.map((t) => t.ok && t.request.id)).size, 1);
      assertEquals(await isDraftSubmitted(client, conversation.id, draftId), true);

      // 3. Невалидные данные заявку не создают.
      const bad = await createBookingRequest(client, {
        conversationId: conversation.id,
        draftId: crypto.randomUUID(),
        date,
        time: "19:30",
        guests: 0,
        name: "Т",
        contact: "абв",
        comment: null,
      });
      assert(!bad.ok);
      assertEquals(Object.keys(bad.errors).sort(), ["contact", "guests", "name", "time"]);

      // 4. Обращение: то же правило; контакт у вопроса менеджеру обязателен, у жалобы — нет.
      const guestDraft = crypto.randomUUID();
      const complaint = () =>
        createGuestRequest(client, {
          conversationId: conversation.id,
          draftId: guestDraft,
          kind: "complaint",
          text: "тест",
          contact: null,
        });
      const g1 = await complaint();
      const g2 = await complaint();
      assert(g1.ok && g2.ok);
      assertEquals([g1.created, g2.created], [true, false]);
      assertEquals(g1.request.status, "new");
      assertEquals(g1.request.contact, null);

      const noContact = await createGuestRequest(client, {
        conversationId: conversation.id,
        draftId: crypto.randomUUID(),
        kind: "manager_request",
        text: "вопрос",
        contact: null,
      });
      assert(!noContact.ok);
      assertEquals(noContact.errors.contact, "contact_required");
    } finally {
      // conversation_id → set null, поэтому заявки удаляем явно по диалогу до удаления диалога.
      await client.from("booking_requests").delete().eq("conversation_id", conversation.id);
      await client.from("guest_requests").delete().eq("conversation_id", conversation.id);
      await client.from("conversations").delete().eq("id", conversation.id);
    }
  },
});
