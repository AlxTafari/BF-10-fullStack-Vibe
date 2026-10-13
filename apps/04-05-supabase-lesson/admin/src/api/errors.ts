/** Ошибка в сериализуемом виде: в Redux нельзя класть экземпляры Error / PostgrestError. */
export interface ApiError {
  message: string;
  code?: string;
}

interface ErrorLike {
  message?: string;
  code?: string;
}

export const NETWORK_ERROR_MESSAGE = "Нет соединения с сервером. Попробуйте ещё раз";

// Тексты, которыми браузеры сообщают об оборванном fetch (Chrome / Firefox / Safari).
const NETWORK_ERROR_RE = /failed to fetch|networkerror|load failed|network request failed/i;

export function toApiError(e: unknown): ApiError {
  const { message, code } = (e ?? {}) as ErrorLike;
  // Сетевой сбой человеку не нужно показывать как «TypeError: Failed to fetch».
  const text = message && NETWORK_ERROR_RE.test(message) ? NETWORK_ERROR_MESSAGE : (message ?? "Неизвестная ошибка");
  return { message: text, ...(code ? { code } : {}) };
}
