import type { SupabaseClient } from "@supabase/supabase-js";

// RPC ручного режима (S06b, миграция manager_handoff). Клиент — с JWT менеджера: членство в ресторане проверяет
// БД (is_manager_of внутри RPC), а не код функции. С service role эти вызовы вернули бы not_found для всех.

/** Ошибки RPC, которые сервис различает. Остальное пробрасывается как есть. */
export class HandoffRpcError extends Error {
  constructor(readonly code: "not_found" | "handoff_inactive") {
    super(code);
    this.name = "HandoffRpcError";
  }
}

// raise exception 'not_found' в plpgsql приходит в PostgREST как message = 'not_found'.
function toError(error: { message: string }): Error {
  if (error.message === "not_found" || error.message === "handoff_inactive") return new HandoffRpcError(error.message);
  return new Error(error.message);
}

// returns table → PostgREST отдаёт массив из одной строки.
function single<T>(data: unknown): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("пустой ответ RPC");
  return row as T;
}

export async function beginHandoff(
  userClient: SupabaseClient,
  conversationId: string,
): Promise<{ chat_id: number; was_active: boolean; handoff_until: string }> {
  const { data, error } = await userClient.rpc("begin_manager_handoff", { p_conversation_id: conversationId });
  if (error) throw toError(error);
  return single(data);
}

export async function extendHandoff(
  userClient: SupabaseClient,
  conversationId: string,
): Promise<{ chat_id: number; handoff_until: string }> {
  const { data, error } = await userClient.rpc("extend_manager_handoff", { p_conversation_id: conversationId });
  if (error) throw toError(error);
  return single(data);
}

export async function endHandoff(
  userClient: SupabaseClient,
  conversationId: string,
): Promise<{ chat_id: number; restaurant_id: string; was_active: boolean }> {
  const { data, error } = await userClient.rpc("end_manager_handoff", { p_conversation_id: conversationId });
  if (error) throw toError(error);
  return single(data);
}
