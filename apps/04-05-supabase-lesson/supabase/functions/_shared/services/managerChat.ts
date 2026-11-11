// Менеджер в диалоге (S06b): подключение, ответ, отключение. Вызывает Edge Function manager-chat.
// Два клиента: userClient (JWT менеджера) — для RPC, где БД проверяет членство; serviceClient — запись в messages
// (у менеджера нет права insert на messages, и давать его не нужно) и чтение настроек AI.
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatManagerReply, MANAGER_JOINED, managerLeftText } from "../content.ts";
import { checkManagerText } from "../domain/managerChat.ts";
import { beginHandoff, endHandoff, extendHandoff, HandoffRpcError } from "../repositories/handoffRepo.ts";
import { logMessage } from "../repositories/messagesRepo.ts";
import { getAiSettings } from "./aiSettings.ts";

/** Итог отправки в чат гостя. blocked — гость заблокировал бота (Telegram 403). */
export type Delivery = "sent" | "blocked" | "failed";

/** Отправка текста гостю. Сервис не знает про Telegram (ADR-008): функцию и разбор ошибок даёт обработчик. */
export type Deliver = (chatId: number, text: string) => Promise<Delivery>;

export interface ManagerChatDeps {
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  deliver: Deliver;
}

export type JoinResult =
  | { ok: true; handoffUntil: string; delivery: Delivery | "skipped" }
  | { ok: false; error: "not_found" };

export type ReplyResult =
  | { ok: true; handoffUntil: string; delivery: "sent"; recorded: boolean }
  | { ok: true; handoffUntil: string; delivery: "blocked" | "failed" }
  | { ok: false; error: "not_found" | "handoff_inactive" | "invalid_text" };

export type LeaveResult = { ok: true; delivery: Delivery | "skipped" } | { ok: false; error: "not_found" };

/** Ожидаемые отказы RPC → код результата; всё остальное — настоящий сбой, пусть летит в обработчик (500). */
function rpcCode<T extends HandoffRpcError["code"]>(error: unknown, allowed: readonly T[]): T {
  if (error instanceof HandoffRpcError && (allowed as readonly string[]).includes(error.code)) return error.code as T;
  throw error;
}

/**
 * Уведомление гостю от бота и его запись в журнал. Пишем только доставленное: в messages — то, что гость получил.
 * Сбой записи не превращает доставку в ошибку: гость уже получил текст.
 */
async function notifyGuest(deps: ManagerChatDeps, conversationId: string, chatId: number, text: string): Promise<Delivery> {
  const delivery = await deps.deliver(chatId, text);
  if (delivery === "sent") {
    try {
      await logMessage(deps.serviceClient, { conversationId, direction: "out", text });
    } catch (error) {
      console.error("manager-chat: уведомление доставлено, но не записано", error);
    }
  }
  return delivery;
}

/**
 * Подключение. Повторное (вторая вкладка, двойной клик) только продлевает режим — второй раз гостю не пишем.
 * Режим включается и при недоставленном уведомлении: менеджер увидит «гость заблокировал бота» и решит сам.
 */
export async function joinChat(deps: ManagerChatDeps, conversationId: string): Promise<JoinResult> {
  let begun;
  try {
    begun = await beginHandoff(deps.userClient, conversationId);
  } catch (error) {
    return { ok: false, error: rpcCode(error, ["not_found"] as const) };
  }
  const delivery = begun.was_active ? "skipped" : await notifyGuest(deps, conversationId, begun.chat_id, MANAGER_JOINED);
  return { ok: true, handoffUntil: begun.handoff_until, delivery };
}

/**
 * Ответ гостю. Писать можно только в ручном режиме: не подключался или истёк тайм-аут — handoff_inactive,
 * ничего не отправляем. Продление — до отправки: иначе режим мог бы истечь между отправкой и записью.
 */
export async function sendManagerReply(
  deps: ManagerChatDeps,
  input: { conversationId: string; managerId: string; text: unknown },
): Promise<ReplyResult> {
  const checked = checkManagerText(input.text);
  if (!checked.ok) return { ok: false, error: "invalid_text" };

  let extended;
  try {
    extended = await extendHandoff(deps.userClient, input.conversationId);
  } catch (error) {
    return { ok: false, error: rpcCode(error, ["not_found", "handoff_inactive"] as const) };
  }

  const delivery = await deps.deliver(extended.chat_id, formatManagerReply(checked.text));
  if (delivery !== "sent") return { ok: true, handoffUntil: extended.handoff_until, delivery };

  // Гость получил — записываем. Сбой записи: гость сообщение видит, в ленте админки его не будет; менеджеру
  // скажем об этом, а не «ошибка» (повторная отправка продублировала бы сообщение гостю).
  let recorded = true;
  try {
    await logMessage(deps.serviceClient, {
      conversationId: input.conversationId,
      direction: "out",
      text: checked.text,
      meta: { manager: true, managerId: input.managerId },
    });
  } catch (error) {
    recorded = false;
    console.error("manager-chat: ответ доставлен, но не записан", error);
  }
  return { ok: true, handoffUntil: extended.handoff_until, delivery, recorded };
}

/** Отключение. Режим уже истёк — гостю ничего: тайм-аут не сообщается, и «отключился» через час было бы странно. */
export async function leaveChat(deps: ManagerChatDeps, conversationId: string): Promise<LeaveResult> {
  let ended;
  try {
    ended = await endHandoff(deps.userClient, conversationId);
  } catch (error) {
    return { ok: false, error: rpcCode(error, ["not_found"] as const) };
  }
  if (!ended.was_active) return { ok: true, delivery: "skipped" };

  const settings = await getAiSettings(deps.serviceClient, ended.restaurant_id);
  const delivery = await notifyGuest(deps, conversationId, ended.chat_id, managerLeftText(settings.aiEnabled));
  return { ok: true, delivery };
}
