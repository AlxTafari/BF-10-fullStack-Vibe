/** Ошибка в сериализуемом виде: в Redux нельзя класть экземпляры Error / PostgrestError. */
export interface ApiError {
  message: string;
  code?: string;
}

interface ErrorLike {
  message?: string;
  code?: string;
}

export function toApiError(e: unknown): ApiError {
  const { message, code } = (e ?? {}) as ErrorLike;
  return { message: message ?? "Неизвестная ошибка", ...(code ? { code } : {}) };
}
