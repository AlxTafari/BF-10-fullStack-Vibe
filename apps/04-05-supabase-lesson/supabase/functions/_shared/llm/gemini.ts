// Обёртка над SDK Gemini (S09). Единственное место, где импортируется @google/genai (правило check:layers):
// наружу — только наши типы из types.ts. По образцу _shared/telegram/client.ts.
import { ApiError, type Content, FunctionCallingConfigMode, GoogleGenAI, type Part } from "@google/genai";
import {
  type LlmClient,
  LlmError,
  type LlmMessage,
  type LlmRequest,
  type LlmResponse,
  type LlmTranscribeRequest,
  type LlmTranscription,
  type LlmUsage,
} from "./types.ts";

/**
 * generateContent, а не чат SDK и не Interactions API: у Google ничего не хранится, каждый вызов несёт
 * контекст целиком (историю держим сами в messages, S09 §2).
 */
export function createGeminiClient(apiKey: string, model: string): LlmClient {
  const ai = new GoogleGenAI({
    apiKey,
    // Без повторов внутри SDK: по умолчанию он делает до 5 попыток с паузой до 60 с — это съело бы весь
    // бюджет хода (45 с). Сбой вызова — сразу LlmError, агент сам решает, что ответить гостю.
    httpOptions: { retryOptions: { attempts: 1 } },
  });

  return {
    model,
    async generate(request: LlmRequest): Promise<LlmResponse> {
      // Таймаут одного вызова. Отмена — только на нашей стороне: Google запрос дорабатывает и считает токены.
      const signal = AbortSignal.timeout(request.timeoutMs);
      let response;
      try {
        response = await ai.models.generateContent({
          model,
          contents: request.messages.map(toContent),
          config: {
            systemInstruction: request.system,
            tools: request.tools.length > 0
              ? [{
                functionDeclarations: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.parameters,
                })),
              }]
              : undefined,
            // ANY — ответ только вызовом tool (allowedFunctionNames сужает набор); иначе AUTO — модель решает сама.
            toolConfig: request.requireToolCall
              ? { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: request.allowedTools } }
              : undefined,
            abortSignal: signal,
          },
        });
      } catch (error) {
        throw toLlmError(error, signal);
      }

      const content = response.candidates?.[0]?.content;
      const calls = response.functionCalls ?? [];
      const usage = toUsage(response.usageMetadata);
      if (calls.length > 0) {
        return {
          kind: "tool_calls",
          calls: calls.map((c) => ({ id: c.id, name: c.name ?? "", args: c.args ?? {} })),
          text: textOf(content),
          // Ответ модели целиком: в нём подписи рассуждений (thoughtSignature), без которых Gemini 3
          // отклонит следующий вызов этого хода. Вернётся модели как есть (см. toContent).
          providerState: content,
          usage,
        };
      }
      const text = textOf(content);
      // Пусто: модель ничего не сказала или ответ срезан фильтрами безопасности (finishReason SAFETY и т.п.).
      if (!text) throw new LlmError("bad_response", `empty response, finishReason=${response.candidates?.[0]?.finishReason}`);
      return { kind: "text", text, usage };
    },

    async transcribe(request: LlmTranscribeRequest): Promise<LlmTranscription> {
      const signal = AbortSignal.timeout(request.timeoutMs);
      let response;
      try {
        response = await ai.models.generateContent({
          model,
          // Аудио inline (base64): до 20 МБ на запрос, у нас предел меньше (VOICE_MAX_BYTES). Files API не нужен —
          // он для файлов, которые переиспользуются в нескольких запросах.
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: request.mimeType, data: toBase64(request.audio) } }] }],
          config: {
            systemInstruction: request.system,
            // Структурированный ответ: модель обязана вернуть JSON этой формы.
            responseMimeType: "application/json",
            responseJsonSchema: TRANSCRIPTION_SCHEMA,
            abortSignal: signal,
          },
        });
      } catch (error) {
        throw toLlmError(error, signal);
      }
      const usage = toUsage(response.usageMetadata);
      const parsed = parseTranscription(textOf(response.candidates?.[0]?.content));
      if (!parsed) throw new LlmError("bad_response", `bad transcription, finishReason=${response.candidates?.[0]?.finishReason}`);
      return { ...parsed, usage };
    },
  };
}

const TRANSCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "What the guest said, verbatim. Empty if unclear." },
    unclear: { type: "boolean", description: "True if there is no intelligible speech." },
  },
  required: ["text", "unclear"],
};

/** JSON распознавателя → наша структура. Не та форма или не JSON — null (вызывающий бросит bad_response). */
export function parseTranscription(raw: string | undefined): { text: string; unclear: boolean } | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { text, unclear } = value as Record<string, unknown>;
  if (typeof text !== "string" || typeof unclear !== "boolean") return null;
  return { text, unclear };
}

/**
 * Байты → base64 для inlineData. Кусками: String.fromCharCode(...bytes) на целом файле упрётся в предел
 * числа аргументов функции (около 100 тыс.), а голосовое — сотни килобайт.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Наше сообщение → Content SDK. Результаты tools у Gemini отправляются от роли user. */
function toContent(message: LlmMessage): Content {
  switch (message.role) {
    case "user":
      return { role: "user", parts: [{ text: message.text }] };
    case "tool":
      return {
        role: "user",
        parts: message.results.map((r) => ({ functionResponse: { id: r.callId, name: r.name, response: r.result } })),
      };
    case "model": {
      // Ответ этого же хода — возвращаем исходный Content с подписями, а не пересобираем.
      if (message.providerState) return message.providerState as Content;
      const parts: Part[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.toolCalls ?? []) parts.push({ functionCall: { id: call.id, name: call.name, args: call.args } });
      return { role: "model", parts };
    }
  }
}

/** Текст ответа без «мыслей»: части с thought = true — рассуждения модели, гостю их не показываем. */
function textOf(content: Content | undefined): string | undefined {
  const text = (content?.parts ?? [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  return text || undefined;
}

/** usageMetadata Gemini → наш расход. Поля, которых нет, — 0 (у ответа без «размышлений» thoughts не приходит). */
function toUsage(meta: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined): LlmUsage {
  return {
    input: meta?.promptTokenCount ?? 0,
    output: meta?.candidatesTokenCount ?? 0,
    thoughts: meta?.thoughtsTokenCount ?? 0,
  };
}

/**
 * Имена исчерпанных лимитов из текста 429: «quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier»,
 * «metric: generativelanguage.googleapis.com/…». По ним видно, какой лимит кончился (в минуту, в сутки,
 * бесплатный уровень). Берём только имена — остальной текст ошибки в лог не идёт.
 */
export function quotaNames(message: string): string[] {
  const names = [...message.matchAll(/\b(?:quotaId|quota_id|metric)\W{1,4}([\w./-]{3,120})/g)].map((m) => m[1]);
  return [...new Set(names)];
}

/** Класс ошибки для агента. Текст ошибки SDK в лог не уходит целиком: в нём может быть кусок запроса. */
function toLlmError(error: unknown, signal: AbortSignal): LlmError {
  if (signal.aborted) return new LlmError("timeout", "gemini call timed out");
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const names = quotaNames(error.message);
      return new LlmError("quota", `gemini quota exceeded${names.length ? `: ${names.join(", ")}` : ""}`);
    }
    return new LlmError("unavailable", `gemini api error ${error.status}`);
  }
  return new LlmError("unavailable", error instanceof Error ? error.name : "unknown");
}
