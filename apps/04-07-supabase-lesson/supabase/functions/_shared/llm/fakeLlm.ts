// Подменный LLM для тестов агента и сценариев (S09): без сети, ответы заданы заранее.
// Как fakeTelegram: боевой код получает клиента параметром и о подмене не знает.

// async без await намеренно: ошибка из throw становится отклонённым Promise, как у настоящего клиента.
// deno-lint-ignore-file require-await
import {
  type LlmClient,
  LlmError,
  type LlmErrorKind,
  type LlmRequest,
  type LlmResponse,
  type LlmTranscribeRequest,
  type LlmTranscription,
} from "./types.ts";

/** Шаг сценария: готовый ответ, ошибка заданного класса или функция от запроса (для проверок по ходу). */
export type FakeLlmStep = LlmResponse | { error: LlmErrorKind } | ((request: LlmRequest) => LlmResponse);

/** Шаг распознавания — своя очередь: голосовой тест задаёт расшифровку отдельно от ответов агента. */
export type FakeTranscribeStep = LlmTranscription | { error: LlmErrorKind };

export interface FakeLlm extends LlmClient {
  /** Все запросы к модели по порядку — что агент ей передал. */
  readonly requests: LlmRequest[];
  /** Запросы на распознавание по порядку. */
  readonly transcribeRequests: LlmTranscribeRequest[];
  /** Сколько шагов ещё не израсходовано (обе очереди): в конце теста обычно 0. */
  remaining(): number;
}

/** Ответы выдаются по очереди. Кончились — ошибка теста: агент сделал больше вызовов, чем ожидалось. */
export function createFakeLlm(steps: FakeLlmStep[], model = "fake-model", transcriptions: FakeTranscribeStep[] = []): FakeLlm {
  const queue = [...steps];
  const transcribeQueue = [...transcriptions];
  const requests: LlmRequest[] = [];
  const transcribeRequests: LlmTranscribeRequest[] = [];
  return {
    model,
    requests,
    transcribeRequests,
    remaining: () => queue.length + transcribeQueue.length,
    async transcribe(request: LlmTranscribeRequest): Promise<LlmTranscription> {
      transcribeRequests.push(request);
      const step = transcribeQueue.shift();
      if (!step) throw new Error("fakeLlm: неожиданное распознавание, сценарий исчерпан");
      if ("error" in step) throw new LlmError(step.error, `fake ${step.error}`);
      return step;
    },
    async generate(request: LlmRequest): Promise<LlmResponse> {
      // Копия: агент дописывает в свой массив сообщений, а тесту нужен снимок на момент вызова.
      requests.push({ ...request, messages: [...request.messages] });
      const step = queue.shift();
      if (!step) throw new Error("fakeLlm: неожиданный вызов, сценарий исчерпан");
      if (typeof step === "function") return step(request);
      if ("error" in step) throw new LlmError(step.error, `fake ${step.error}`);
      return step;
    },
  };
}

// Короткие конструкторы ответов для читаемых тестов.

/** Финальный ответ агента — вызов tool reply: текст + кнопки (так отвечает модель в режиме requireToolCall). */
export const answer = (text: string, actions: Record<string, unknown>[] = []): LlmResponse => ({
  kind: "tool_calls",
  calls: [{ name: "reply", args: { text, actions } }],
});
/** Простой текст — провайдер вернул его вопреки requireToolCall; агент принимает как ответ без кнопок. */
export const say = (text: string): LlmResponse => ({ kind: "text", text });
export const call = (name: string, args: Record<string, unknown> = {}, id?: string): LlmResponse => ({
  kind: "tool_calls",
  calls: [{ id, name, args }],
});
/** Расшифровка голосового с небольшим расходом — как от настоящей модели. */
export const heard = (text: string): LlmTranscription => ({ text, unclear: false, usage: { input: 320, output: 20, thoughts: 0 } });
/** Речь не разобрать. */
export const unclear = (): LlmTranscription => ({ text: "", unclear: true, usage: { input: 320, output: 5, thoughts: 0 } });
