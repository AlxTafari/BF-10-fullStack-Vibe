// knowledgeApi на подменённом supabase-клиенте: что уходит в Edge Function и RPC и как ошибки становятся
// текстом для менеджера. Сеть и БД не нужны; RLS и сама RPC проверены интеграционными тестами (rls.integration).
import { configureStore } from "@reduxjs/toolkit";
import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const rpc = vi.fn();
const maybeSingle = vi.fn();
// Цепочка from().select().eq().maybeSingle() — нужен только конец.
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));
vi.mock("./supabaseClient", () => ({ supabase: { functions: { invoke }, rpc, from } }));

const { baseApi } = await import("./baseApi");
const { knowledgeApi } = await import("./knowledgeApi");

function createTestStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
}

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  maybeSingle.mockReset();
});

describe("indexKnowledgeSource", () => {
  it("тело запроса — { action, id }; ответ — итог индексации", async () => {
    invoke.mockResolvedValue({ data: { status: "ready" }, error: null });
    const store = createTestStore();
    const result = await store.dispatch(knowledgeApi.endpoints.indexKnowledgeSource.initiate({ source: "dish", id: "d1" }));
    expect(invoke).toHaveBeenCalledWith("knowledge-index", { body: { action: "dish", id: "d1" } });
    expect(result.data).toEqual({ status: "ready" });
  });

  it("код из тела 4xx/5xx → текст для менеджера и code", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(503, { error: "ai_unavailable" }) });
    const store = createTestStore();
    const result = await store.dispatch(knowledgeApi.endpoints.indexKnowledgeSource.initiate({ source: "document", id: "x" }));
    expect(result.error).toMatchObject({ code: "ai_unavailable" });
    expect((result.error as { message: string }).message).toContain("Gemini");
  });

  it("тело без JSON — общий текст без кода", async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response("oops", { status: 502 })) });
    const store = createTestStore();
    const result = await store.dispatch(knowledgeApi.endpoints.indexKnowledgeSource.initiate({ source: "document", id: "x" }));
    expect(result.error).toEqual({ message: "Индексатор недоступен, попробуйте позже" });
  });

  it("сетевой сбой — обычный текст «нет соединения»", async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError("Failed to fetch")) });
    const store = createTestStore();
    const result = await store.dispatch(knowledgeApi.endpoints.indexKnowledgeSource.initiate({ source: "document", id: "x" }));
    expect((result.error as { message: string }).message).toMatch(/соединения|Failed/);
  });
});

describe("reindexKnowledgePortion", () => {
  it("передаёт ресторан и курсор порции", async () => {
    const portion = { ready: 1, error: 0, skipped: 0, superseded: 0, errors: [], nextCursor: null };
    invoke.mockResolvedValue({ data: portion, error: null });
    const store = createTestStore();
    const cursor = { source: "document" as const, id: "d9" };
    const result = await store.dispatch(knowledgeApi.endpoints.reindexKnowledgePortion.initiate({ restaurantId: "r1", cursor }));
    expect(invoke).toHaveBeenCalledWith("knowledge-index", { body: { action: "all", restaurantId: "r1", cursor } });
    expect(result.data).toEqual(portion);
  });
});

describe("saveKnowledgeDocument", () => {
  const values = { title: "Т", body: "Б", is_published: true, dishIds: ["a"] };

  it("не подборка — пустые связи; новый документ — p_id = null", async () => {
    rpc.mockResolvedValue({ data: "new-id", error: null });
    const store = createTestStore();
    const result = await store.dispatch(
      knowledgeApi.endpoints.saveKnowledgeDocument.initiate({ id: null, values: { ...values, type: "event" } }),
    );
    expect(rpc).toHaveBeenCalledWith("save_knowledge_document", expect.objectContaining({ p_id: null, p_dish_ids: [] }));
    expect(result.data).toBe("new-id");
  });

  it("исключение RPC → русский текст, код сохраняется", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "invalid_dishes", code: "P0001" } });
    const store = createTestStore();
    const result = await store.dispatch(
      knowledgeApi.endpoints.saveKnowledgeDocument.initiate({ id: "d1", values: { ...values, type: "collection" } }),
    );
    expect(result.error).toEqual({ message: expect.stringContaining("удалённое"), code: "invalid_dishes" });
  });
});

describe("getKnowledgeDocument", () => {
  it("блюда подборки — в порядке sort_order, вложенный массив убран из строки", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: "d1",
        title: "Лёгкое",
        knowledge_document_dishes: [
          { menu_item_id: "b", sort_order: 1 },
          { menu_item_id: "a", sort_order: 0 },
        ],
      },
      error: null,
    });
    const store = createTestStore();
    const result = await store.dispatch(knowledgeApi.endpoints.getKnowledgeDocument.initiate("d1"));
    expect(result.data?.dishIds).toEqual(["a", "b"]);
    expect(result.data?.document).toEqual({ id: "d1", title: "Лёгкое" });
  });

  it("нет строки (чужой или удалённый) → not_found", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const store = createTestStore();
    const result = await store.dispatch(knowledgeApi.endpoints.getKnowledgeDocument.initiate("zzz"));
    expect(result.error).toMatchObject({ code: "not_found" });
  });
});
