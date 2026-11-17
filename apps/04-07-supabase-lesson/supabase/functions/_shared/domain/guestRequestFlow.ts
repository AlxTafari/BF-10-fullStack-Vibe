// Сценарий обращения: тип → текст → контакт → сводка → подтверждение. С карточки — «✏️ Исправить»: меню пунктов,
// шаг выбранного пункта и снова карточка (S09).
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
  type GuestRequestEditField,
  type GuestRequestKind,
  type GuestRequestState,
  type GuestRequestStep,
} from "./flowState.ts";
import { buildGuestRequestSummary, changedGuestRequestFields } from "./requestSummaries.ts";

/** Для вопроса менеджеру без контакта ответить некуда, для отзыва и жалобы — можно оставить анонимно. */
export function isContactRequired(kind: GuestRequestKind | undefined): boolean {
  return kind === "manager_request";
}

/**
 * Экран текущего шага. Экспортируется для черновика от агента (guestRequestDraft.ts).
 * changed — пункты, изменённые исправлением: на карточке они помечены ✏️.
 */
export function guestRequestScreen(state: GuestRequestState, env: FlowEnv, changed: GuestRequestEditField[] = []): FlowScreen {
  const { data } = state;
  switch (state.step) {
    case "kind":
      // editing — только при исправлении: обычный экран не меняется.
      return state.editFrom ? { screen: "ask_kind", editing: true } : { screen: "ask_kind" };
    case "text":
      return { screen: "ask_text", kind: data.kind! };
    case "contact":
      return { screen: "ask_contact", canUseUsername: env.username !== null, optional: !isContactRequired(data.kind) };
    case "confirm":
      return { screen: "confirm", flow: "guest_request", summary: buildGuestRequestSummary(data, changed) };
    case "edit":
      return { screen: "edit_menu", flow: "guest_request", fields: EDIT_FIELDS };
  }
}

const EDIT_FIELDS: GuestRequestEditField[] = ["kind", "text", "contact"];

/**
 * Первый шаг, данных которого ещё нет: так после исправления пункта гость возвращается к карточке, а не проходит
 * следующие шаги заново. Пропущенный контакт (null) — пройденный шаг.
 */
function firstMissingStep(data: GuestRequestData): GuestRequestStep {
  return !data.kind ? "kind" : data.text === undefined ? "text" : data.contact === undefined ? "contact" : "confirm";
}

/**
 * Дошли до карточки — исправление закончено: снимок «до» больше не нужен, а разница с ним — что пометить ✏️.
 * Экспортируется для черновика агента (guestRequestDraft.ts).
 */
export function settleGuestRequest(state: GuestRequestState): { state: GuestRequestState; changed: GuestRequestEditField[] } {
  if (state.step !== "confirm" || !state.editFrom) return { state, changed: [] };
  const { editFrom, ...rest } = state;
  return { state: rest, changed: changedGuestRequestFields(editFrom, state.data) };
}

/** Данные, без которых шаг не имеет смысла (битое состояние в БД), — начинаем сценарий заново. */
function isConsistent(state: GuestRequestState): boolean {
  const { step, data } = state;
  if (step === "kind") return true;
  if (!data.kind) return false;
  if (step === "text") return true;
  if (data.text === undefined) return false;
  if (step === "contact") return true;
  // confirm и меню исправления: контакт либо введён, либо осознанно пропущен — и пропуск допустим не для всех типов.
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
  return { state, reply: { screen: guestRequestScreen(state, env) } };
}

export function advanceGuestRequest(state: GuestRequestState, input: FlowInput, env: FlowEnv): AdvanceResult {
  if (input.type === "action" && input.action === "restart") return startGuestRequest(env);
  if (!isConsistent(state)) return startGuestRequest(env);

  const touched: GuestRequestState = { ...state, touchedAt: env.now.toISOString() };
  const stay = (error: FlowErrorCode): AdvanceResult => ({
    state: touched,
    reply: { screen: guestRequestScreen(touched, env), error },
  });
  const next = (step: GuestRequestStep, patch: Partial<GuestRequestData>): AdvanceResult => {
    const { state: moved, changed } = settleGuestRequest({ ...touched, step, data: { ...touched.data, ...patch } });
    return { state: moved, reply: { screen: guestRequestScreen(moved, env, changed) } };
  };
  /** Записать поля и перейти к первому незаполненному шагу (при исправлении — обычно сразу к карточке). */
  const forward = (patch: Partial<GuestRequestData>, from: GuestRequestState = touched): AdvanceResult => {
    const data = { ...from.data, ...patch };
    // Сменили тип на вопрос менеджеру, а контакт был пропущен — пропуск больше не годится, контакт спросим.
    if (data.contact === null && isContactRequired(data.kind)) delete data.contact;
    const { state: moved, changed } = settleGuestRequest({ ...from, data, step: firstMissingStep(data) });
    return { state: moved, reply: { screen: guestRequestScreen(moved, env, changed) } };
  };

  if (input.type === "action" && input.action === "back") {
    // Посреди исправления «Назад» — отказ от него: данные до исправления и карточка.
    if (touched.editFrom) {
      const { editFrom, ...rest } = touched;
      const restored: GuestRequestState = { ...rest, step: "confirm", data: editFrom };
      return { state: restored, reply: { screen: guestRequestScreen(restored, env) } };
    }
    // Из меню «Что исправить?» — обратно к карточке.
    if (touched.step === "edit") return next("confirm", {});
    const prev = goBack(touched);
    if (!prev) return stay("unavailable");
    return { state: prev, reply: { screen: guestRequestScreen(prev, env) } };
  }

  switch (state.step) {
    case "kind": {
      if (input.type === "text") return stay("use_buttons");
      const kind = /^k=(.+)$/.exec(input.action)?.[1] as GuestRequestKind | undefined;
      return kind && GUEST_REQUEST_KINDS.includes(kind) ? forward({ kind }) : stay("unavailable");
    }
    case "text": {
      if (input.type === "action") return stay("use_buttons");
      const v = validateRequestText(input.text);
      return v.ok ? forward({ text: v.value }) : stay(v.error);
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
      if (input.action === "edit") return next("edit", {});
      if (input.action !== "send") return stay("unavailable");
      // Состояние не меняем: если создание заявки упадёт, гость нажмёт «Отправить» ещё раз.
      return { state: touched, reply: { screen: { screen: "submit" } } };
    }
    case "edit": {
      if (input.type === "text") return stay("use_buttons");
      const field = /^e=(\w+)$/.exec(input.action)?.[1] as GuestRequestEditField | undefined;
      if (!field || !EDIT_FIELDS.includes(field)) return stay("unavailable");
      const data = { ...touched.data };
      delete data[field];
      return forward({}, { ...touched, data, editFrom: touched.data });
    }
  }
}
