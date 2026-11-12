// Наши типы общения с LLM (S09). Агент и тесты знают только их; SDK Gemini живёт за ними в gemini.ts.
// Смена провайдера = новая реализация LlmClient, агент не меняется.

/** JSON Schema параметров tool: подмножество, которое понимают и Gemini, и любой другой провайдер. */
export interface LlmJsonSchema {
  type: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, LlmJsonSchema>;
  required?: string[];
  items?: LlmJsonSchema;
  enum?: string[];
}

/** Описание tool для модели: имя, когда его звать (description) и форма аргументов. */
export interface LlmToolSchema {
  name: string;
  description: string;
  parameters: LlmJsonSchema & { type: "object" };
}

/** Модель просит вызвать tool. args — непроверенные данные от модели: их валидирует реестр tools. */
export interface LlmToolCall {
  /** id вызова, если провайдер его выдал: ответ на вызов возвращается с тем же id. */
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** Результат tool, который уходит модели обратно. */
export interface LlmToolResult {
  callId?: string;
  name: string;
  result: Record<string, unknown>;
}

/**
 * Одно сообщение контекста.
 * - user — текст гостя;
 * - model — ответ модели: текст и/или вызовы tools. providerState — непрозрачные данные провайдера
 *   (у Gemini 3 — подписи рассуждений), их нужно вернуть модели внутри того же хода без изменений.
 *   Агент поле не читает и не разбирает; в истории из БД его нет — там только текст;
 * - tool — результаты вызовов, о которых модель просила в предыдущем сообщении.
 */
export type LlmMessage =
  | { role: "user"; text: string }
  | { role: "model"; text?: string; toolCalls?: LlmToolCall[]; providerState?: unknown }
  | { role: "tool"; results: LlmToolResult[] };

export interface LlmRequest {
  /** Системный промпт: правила поведения, не данные гостя. */
  system: string;
  messages: LlmMessage[];
  tools: LlmToolSchema[];
  /**
   * true — модель обязана ответить вызовом tool, простой текст запрещён (у Gemini — режим ANY). Агент так
   * получает финальный ответ только через tool reply: текст и кнопки в одном действии.
   */
  requireToolCall?: boolean;
  /** Из tools разрешены только эти (например, на последнем раунде — только reply). Не задано — все. */
  allowedTools?: string[];
  /** Предел одного вызова. Сработал — LlmError("timeout"). */
  timeoutMs: number;
}

/**
 * Расход токенов одного вызова — из ответа провайдера. По нему считается стоимость (S09: статистика в админке).
 * thoughts — «размышления» модели: оплачиваются как выход, но провайдер считает их отдельно.
 */
export interface LlmUsage {
  input: number;
  output: number;
  thoughts: number;
}

/** Ответ модели: либо финальный текст, либо просьба вызвать tools (текст рядом возможен, но не обязателен). */
export type LlmResponse =
  | { kind: "text"; text: string; usage?: LlmUsage }
  | { kind: "tool_calls"; calls: LlmToolCall[]; text?: string; providerState?: unknown; usage?: LlmUsage };

/**
 * Почему вызов не удался — агенту важен только класс, не текст ошибки:
 * quota — исчерпан лимит провайдера (429), timeout — не уложились в timeoutMs,
 * unavailable — сеть, 5xx, неверный ключ, bad_response — ответ пустой или заблокирован фильтрами.
 */
export type LlmErrorKind = "quota" | "timeout" | "unavailable" | "bad_response";

export class LlmError extends Error {
  /** message — без данных гостя: только класс сбоя и, для quota, имя исчерпанного лимита провайдера. */
  constructor(readonly kind: LlmErrorKind, message: string) {
    super(message);
    this.name = "LlmError";
  }
}

/** Распознать голосовое (S09, сессия 4): аудио inline, без tools и истории. */
export interface LlmTranscribeRequest {
  /** Инструкция распознавателю — из domain (TRANSCRIBE_INSTRUCTION), провайдер её не сочиняет. */
  system: string;
  audio: Uint8Array;
  /** audio/ogg — голосовые Telegram (Opus). */
  mimeType: string;
  timeoutMs: number;
}

/**
 * Ответ распознавателя. Провайдер отдаёт его структурой (у Gemini — JSON по схеме), а не свободным текстом:
 * иначе «не разобрал» модели пришлось бы писать словами, и это ушло бы агенту как реплика гостя.
 * unclear = true — речи не разобрать, text пустой.
 */
export interface LlmTranscription {
  text: string;
  unclear: boolean;
  usage?: LlmUsage;
}

export interface LlmClient {
  /** Имя модели — пишется в messages.meta, чтобы в админке было видно, кто ответил. */
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
  /** Ошибки — те же LlmError, что у generate. */
  transcribe(request: LlmTranscribeRequest): Promise<LlmTranscription>;
}
