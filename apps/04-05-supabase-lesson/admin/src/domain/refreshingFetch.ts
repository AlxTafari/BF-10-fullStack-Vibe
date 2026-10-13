// Тихий refresh сессии при 401. Чистая логика без supabase-js: зависимости приходят аргументами, поэтому тестируется.

export interface RefreshingFetchDeps {
  /** Настоящий fetch. */
  fetchImpl: typeof fetch;
  /** Обновить сессию. Новый access_token или null, если обновить не удалось. */
  refresh: () => Promise<string | null>;
  /** Обновить не удалось → сессия мертва: вызывающий выходит из аккаунта (локально). */
  onSessionLost: () => Promise<void>;
  /** К каким адресам применять повтор. Запросы самого Auth трогать нельзя: refresh сам их использует. */
  shouldRetry: (url: string) => boolean;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * fetch, который при 401 один раз обновляет сессию и повторяет запрос с новым токеном.
 * Повтор тоже 401 или refresh не удался → возвращается исходный ответ, а при мёртвой сессии — выход.
 * Больше одного повтора не делаем: бесконечный цикл на отозванном доступе нам не нужен.
 */
export function createRefreshingFetch(deps: RefreshingFetchDeps): typeof fetch {
  return async (input, init) => {
    const response = await deps.fetchImpl(input, init);
    if (response.status !== 401 || !deps.shouldRetry(urlOf(input))) return response;

    const token = await deps.refresh();
    if (token === null) {
      await deps.onSessionLost();
      return response;
    }

    // Заголовки берём из init, а если запрос передан объектом Request — из него.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${token}`);
    return deps.fetchImpl(input, { ...init, headers });
  };
}
