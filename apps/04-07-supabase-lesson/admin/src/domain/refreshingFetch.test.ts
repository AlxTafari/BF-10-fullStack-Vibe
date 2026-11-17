import { describe, expect, it, vi } from "vitest";
import { createRefreshingFetch } from "./refreshingFetch";

const REST = "https://x.supabase.co/rest/v1/faq_entries";
const res = (status: number) => new Response(null, { status });

function setup(responses: Response[], refreshResult: string | null = "new-token") {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const refresh = vi.fn().mockResolvedValue(refreshResult);
  const onSessionLost = vi.fn().mockResolvedValue(undefined);
  const wrapped = createRefreshingFetch({
    fetchImpl,
    refresh,
    onSessionLost,
    shouldRetry: (url) => url.includes("/rest/v1/"),
  });
  return { fetchImpl, refresh, onSessionLost, wrapped };
}

describe("createRefreshingFetch", () => {
  it("не-401 проходит как есть, refresh не вызывается", async () => {
    const { wrapped, refresh, fetchImpl } = setup([res(200)]);
    expect((await wrapped(REST)).status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("401 → refresh → повтор с новым токеном", async () => {
    const { wrapped, refresh, fetchImpl } = setup([res(401), res(200)]);
    const out = await wrapped(REST, { headers: { Authorization: "Bearer old", apikey: "k" } });
    expect(out.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(retryHeaders.get("Authorization")).toBe("Bearer new-token");
    expect(retryHeaders.get("apikey")).toBe("k"); // остальные заголовки сохранены
  });

  it("повтор тоже 401 → отдаём его, цикла нет", async () => {
    const { wrapped, refresh, fetchImpl, onSessionLost } = setup([res(401), res(401)]);
    expect((await wrapped(REST)).status).toBe(401);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it("refresh не удался → исходный 401 и выход", async () => {
    const { wrapped, fetchImpl, onSessionLost } = setup([res(401)], null);
    expect((await wrapped(REST)).status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it("401 на адресе вне shouldRetry (Auth) не трогаем", async () => {
    const { wrapped, refresh, onSessionLost } = setup([res(401)]);
    expect((await wrapped("https://x.supabase.co/auth/v1/token")).status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it("адрес как URL и как Request", async () => {
    const a = setup([res(401), res(200)]);
    expect((await a.wrapped(new URL(REST))).status).toBe(200);
    const b = setup([res(401), res(200)]);
    expect((await b.wrapped(new Request(REST, { headers: { apikey: "k" } }))).status).toBe(200);
    const headers = new Headers(b.fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(headers.get("apikey")).toBe("k");
  });
});
