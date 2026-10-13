import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { advanceBooking, startBooking } from "../domain/bookingFlow.ts";
import {
  type AdvanceResult,
  type BookingState,
  type FlowEnv,
  type FlowInput,
  type FlowState,
  type GuestRequestKind,
  type GuestRequestState,
  parseFlowState,
} from "../domain/flowState.ts";
import { advanceGuestRequest, startGuestRequest } from "../domain/guestRequestFlow.ts";
import { setConversationState } from "../repositories/conversationsRepo.ts";
import { getRestaurant } from "../repositories/restaurantsRepo.ts";
import type { BookingRequestRow, ConversationRow, GuestRequestRow } from "../types.ts";
import { type BookingFieldErrors, createBookingRequest } from "./bookingRequests.ts";
import { createGuestRequest, type GuestRequestFieldErrors } from "./guestRequests.ts";

/**
 * Живое состояние сценария из диалога. null — сценария нет: `{}`, битые данные
 * или сценарий брошен дольше FLOW_TTL (истёкшее состояние считаем отсутствующим).
 * Диалог уже прочитан в начале апдейта, лишний запрос не нужен.
 */
export function getFlowState(conversation: ConversationRow, now: Date = new Date()): FlowState | null {
  return parseFlowState(conversation.state, now);
}

export async function saveFlowState(client: SupabaseClient, conversationId: string, state: FlowState): Promise<void> {
  await setConversationState(client, conversationId, state as unknown as Record<string, unknown>);
}

/** Сбрасывает сценарий: state = {}. Безопасно вызывать, когда сценария нет. */
export async function cancelFlow(client: SupabaseClient, conversationId: string): Promise<void> {
  await setConversationState(client, conversationId, {});
}

// ---------------------------------------------------------------- запуск и шаги сценария

async function loadEnv(client: SupabaseClient, username: string | null): Promise<FlowEnv> {
  const restaurant = await getRestaurant(client);
  if (!restaurant) throw new Error("ресторан не заведён");
  return {
    now: new Date(),
    timeZone: restaurant.timezone,
    openingHours: restaurant.opening_hours,
    username,
    newDraftId: () => crypto.randomUUID(),
  };
}

/** Начинает новый сценарий (перезаписывает прежний) и возвращает, что показать гостю. */
export async function startFlow(
  client: SupabaseClient,
  conversationId: string,
  flow: FlowState["flow"],
  username: string | null,
): Promise<AdvanceResult> {
  const env = await loadEnv(client, username);
  const result = flow === "booking" ? startBooking(env) : startGuestRequest(env);
  await saveFlowState(client, conversationId, result.state);
  return result;
}

/** Применяет ввод гостя к живому сценарию, сохраняет новое состояние, возвращает ответ. */
export async function continueFlow(
  client: SupabaseClient,
  conversationId: string,
  state: FlowState,
  input: FlowInput,
  username: string | null,
): Promise<AdvanceResult> {
  const env = await loadEnv(client, username);
  const result = state.flow === "booking"
    ? advanceBooking(state, input, env)
    : advanceGuestRequest(state, input, env);
  await saveFlowState(client, conversationId, result.state);
  return result;
}

// ---------------------------------------------------------------- отправка заявки

export type SubmitResult =
  | { ok: true; kind: "booking"; request: BookingRequestRow; created: boolean }
  | { ok: true; kind: "guest_request"; request: GuestRequestRow; created: boolean }
  | { ok: false; errors: BookingFieldErrors | GuestRequestFieldErrors };

/**
 * Создаёт заявку из подтверждённого черновика. Состояние сценария очищается только после
 * успешной вставки: если она упала (исключение), гость нажмёт «Отправить» ещё раз и получит ту же заявку.
 * `created: false` — заявка уже была (двойной тап, повторная доставка): уведомлять менеджера не нужно.
 */
export async function submitFlow(
  client: SupabaseClient,
  conversationId: string,
  state: FlowState,
): Promise<SubmitResult> {
  if (state.flow === "booking") {
    const d = (state as BookingState).data;
    const r = await createBookingRequest(client, {
      conversationId,
      draftId: state.draftId,
      date: d.date ?? "",
      time: d.time ?? "",
      guests: d.guests ?? 0,
      name: d.name ?? "",
      contact: d.contact ?? "",
      comment: d.comment ?? null,
    });
    if (!r.ok) return r;
    await cancelFlow(client, conversationId);
    return { ok: true, kind: "booking", request: r.request, created: r.created };
  }

  const d = (state as GuestRequestState).data;
  const r = await createGuestRequest(client, {
    conversationId,
    draftId: state.draftId,
    // Неполные данные не маскируем «значениями по умолчанию»: отсутствующий тип отклонит валидация сервиса.
    kind: d.kind as GuestRequestKind,
    text: d.text ?? "",
    contact: d.contact ?? null,
  });
  if (!r.ok) return r;
  await cancelFlow(client, conversationId);
  return { ok: true, kind: "guest_request", request: r.request, created: r.created };
}
