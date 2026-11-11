import { describe, expect, it } from "vitest";
import { toConversationEventRow, toMessage } from "./chatMappers";

const message = (meta: unknown) => ({
  id: "m1",
  conversation_id: "c1",
  direction: "out",
  kind: "text",
  text: "ответ",
  created_at: "2026-11-11T10:00:00+00:00",
  meta,
});

describe("toMessage: пометка AI из meta (S09)", () => {
  it("ответ агента — reply, запасной ответ — fallback, без meta — null", () => {
    expect(toMessage(message({ ai: true, model: "m", tools: [] }))?.ai).toBe("reply");
    expect(toMessage(message({ aiFallback: "limit" }))?.ai).toBe("fallback");
    expect(toMessage(message(null))?.ai).toBeNull();
    expect(toMessage(message("мусор"))?.ai).toBeNull();
  });
});

describe("toConversationEventRow: пометка угрозы (S09)", () => {
  const base = {
    id: "c1",
    display_name: null,
    channel: "telegram",
    created_at: "2026-11-11T10:00:00+00:00",
    last_message_at: "2026-11-11T10:00:00+00:00",
    last_message_preview: null,
    last_message_direction: null,
    manager_last_read_at: null,
  };

  it("пометка читается; без колонок — «не помечен», строка не отбрасывается", () => {
    expect(toConversationEventRow({ ...base, flagged_at: "2026-11-11T10:00:01+00:00", flag_reason: "угроза" })).toMatchObject({ flag_reason: "угроза" });
    expect(toConversationEventRow(base)).toMatchObject({ flagged_at: null, flag_reason: null });
  });

  it("неверный тип пометки — строка отбрасывается", () => {
    expect(toConversationEventRow({ ...base, flagged_at: 42, flag_reason: "угроза" })).toBeNull();
  });
});
