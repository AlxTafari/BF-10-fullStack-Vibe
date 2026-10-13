// Сценарий обращения: тип → текст → контакт → сводка → подтверждение.
// advance — чистая функция: (состояние, ввод, окружение) → (новое состояние, что показать).
// БД и Telegram не знает; заявку по ответу `submit` создаёт вызывающий.
import { validateContact, validateRequestText } from "./fieldValidation.ts";
import {
  type AdvanceResult,
  type FlowEnv,
  type FlowErrorCode,
  type FlowInput,
  type FlowScreen,
  GUEST_REQUEST_KINDS,
  type GuestRequestData,
  type GuestRequestKind,
  type GuestRequestState,
  type GuestRequestStep,
} from "./flowState.ts";
import { buildGuestRequestSummary } from "./requestSummaries.ts";

/** Для вопроса менеджеру без контакта ответить некуда, для отзыва и жалобы — можно оставить анонимно. */
export function isContactRequired(kind: GuestRequestKind | undefined): boolean {
  return kind === "manager_request";
}

function screenFor(state: GuestRequestState, env: FlowEnv): FlowScreen {
  const { data } = state;
  switch (state.step) {
    case "kind":
      return { screen: "ask_kind" };
    case "text":
      return { screen: "ask_text", kind: data.kind! };
    case "contact":
      return { screen: "ask_contact", canUseUsername: env.username !== null, optional: !isContactRequired(data.kind) };
    case "confirm":
      return { screen: "confirm", flow: "guest_request", summary: buildGuestRequestSummary(data) };
  }
}

/** Данные, без которых шаг не имеет смысла (битое состояние в БД), — начинаем сценарий заново. */
function isConsistent(state: GuestRequestState): boolean {
  const { step, data } = state;
  if (step === "kind") return true;
  if (!data.kind) return false;
  if (step === "text") return true;
  if (data.text === undefined) return false;
  if (step === "contact") return true;
  // confirm: контакт либо введён, либо осознанно пропущен — и пропуск допустим не для всех типов.
  return data.contact !== undefined && !(isContactRequired(data.kind) && data.contact === null);
}

const STEP_ORDER: GuestRequestStep[] = ["kind", "text", "contact", "confirm"];
const STEP_FIELDS: Partial<Record<GuestRequestStep, (keyof GuestRequestData)[]>> = {
  kind: ["kind"],
  text: ["text"],
  contact: ["contact"],
};

/** Шаг назад: данные предыдущего и следующих шагов стираются. null — назад некуда. */
function goBack(state: GuestRequestState): GuestRequestState | null {
  const prevIndex = STEP_ORDER.indexOf(state.step) - 1;
  if (prevIndex < 0) return null;
  const data = { ...state.data };
  for (const s of STEP_ORDER.slice(prevIndex)) {
    for (const field of STEP_FIELDS[s] ?? []) delete data[field];
  }
  return { ...state, step: STEP_ORDER[prevIndex], data };
}

/** Начало сценария. С `kind` (переход из брони на 20+ гостей) шаг выбора типа пропускается. */
export function startGuestRequest(env: FlowEnv, kind?: GuestRequestKind): AdvanceResult {
  const state: GuestRequestState = {
    flow: "guest_request",
    step: kind ? "text" : "kind",
    draftId: env.newDraftId(),
    data: kind ? { kind } : {},
    touchedAt: env.now.toISOString(),
  };
  return { state, reply: { screen: screenFor(state, env) } };
}

export function advanceGuestRequest(state: GuestRequestState, input: FlowInput, env: FlowEnv): AdvanceResult {
  if (input.type === "action" && input.action === "restart") return startGuestRequest(env);
  if (!isConsistent(state)) return startGuestRequest(env);

  const touched: GuestRequestState = { ...state, touchedAt: env.now.toISOString() };
  const stay = (error: FlowErrorCode): AdvanceResult => ({
    state: touched,
    reply: { screen: screenFor(touched, env), error },
  });
  const next = (step: GuestRequestStep, patch: Partial<GuestRequestData>): AdvanceResult => {
    const moved: GuestRequestState = { ...touched, step, data: { ...touched.data, ...patch } };
    return { state: moved, reply: { screen: screenFor(moved, env) } };
  };

  if (input.type === "action" && input.action === "back") {
    const prev = goBack(touched);
    if (!prev) return stay("unavailable");
    return { state: prev, reply: { screen: screenFor(prev, env) } };
  }

  switch (state.step) {
    case "kind": {
      if (input.type === "text") return stay("use_buttons");
      const kind = /^k=(.+)$/.exec(input.action)?.[1] as GuestRequestKind | undefined;
      return kind && GUEST_REQUEST_KINDS.includes(kind) ? next("text", { kind }) : stay("unavailable");
    }
    case "text": {
      if (input.type === "action") return stay("use_buttons");
      const v = validateRequestText(input.text);
      return v.ok ? next("contact", { text: v.value }) : stay(v.error);
    }
    case "contact": {
      if (input.type === "action") {
        if (input.action === "skip") {
          return isContactRequired(state.data.kind) ? stay("contact_required") : next("confirm", { contact: null });
        }
        if (input.action === "me") {
          if (!env.username) return stay("unavailable");
          const v = validateContact(`@${env.username}`);
          return v.ok ? next("confirm", { contact: v.value }) : stay(v.error);
        }
        return stay("unavailable");
      }
      const v = validateContact(input.text);
      return v.ok ? next("confirm", { contact: v.value }) : stay(v.error);
    }
    case "confirm": {
      if (input.type === "text") return stay("use_buttons");
      if (input.action !== "send") return stay("unavailable");
      // Состояние не меняем: если создание заявки упадёт, гость нажмёт «Отправить» ещё раз.
      return { state: touched, reply: { screen: { screen: "submit" } } };
    }
  }
}
