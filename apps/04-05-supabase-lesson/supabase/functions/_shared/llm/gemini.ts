// Обёртка над SDK Gemini (S09). Единственное место, где импортируется @google/genai (правило check:layers):
// наружу — только наши типы из types.ts. По образцу _shared/telegram/client.ts.
import { ApiError, type Content, GoogleGenAI, type Part } from "@google/genai";
import { type LlmClient, LlmError, type LlmMessage, type LlmRequest, type LlmResponse, type LlmUsage } from "./types.ts";

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
  };
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
