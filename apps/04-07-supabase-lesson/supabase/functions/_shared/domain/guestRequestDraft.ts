// Черновик обращения от агента (S09, сессия 3, §4.16): «позовите менеджера, мне не понравилось обслуживание» →
// тип и текст из фразы гостя. Ложится в ТОТ ЖЕ GuestRequestState, что у кнопочного сценария S03; контакт — по его
// правилам (для вопроса менеджеру обязателен, для отзыва и жалобы можно пропустить кнопкой). Обращение не создаёт —
// только кнопка гостя «Отправить». Чистая функция.
import { resolveAgentContact } from "./agentContact.ts";
import { validateRequestText } from "./fieldValidation.ts";
import {
  type DraftError,
  type DraftOutcome,
  type FlowEnv,
  type FlowState,
  GUEST_REQUEST_KINDS,
  type GuestRequestData,
  type GuestRequestKind,
  type GuestRequestState,
  type GuestRequestStep,
} from "./flowState.ts";
import { guestRequestScreen, isContactRequired, settleGuestRequest, startGuestRequest } from "./guestRequestFlow.ts";
import { changedGuestRequestFields } from "./requestSummaries.ts";

export interface GuestRequestDraftInput {
  kind?: string;
  text?: string;
  contact?: string;
  /** Гость просит связаться через его Telegram, не называя ника: контакт = @username из апдейта (agentContact.ts). */
  useTelegram?: boolean;
}

/** Поля черновика для ответа модели: useTelegram — способ задать contact, а не отдельное поле. */
export type GuestRequestDraftField = Exclude<keyof GuestRequestDraftInput, "useTelegram">;

const isKind = (value: string): value is GuestRequestKind => (GUEST_REQUEST_KINDS as string[]).includes(value);

/**
 * Применяет поля от агента к черновику обращения. Живое обращение дополняется, иначе начинается новое
 * (в том числе вместо брони: гость передумал и просит менеджера).
 */
export function applyGuestRequestDraft(
  current: FlowState | null,
  input: GuestRequestDraftInput,
  env: FlowEnv,
): DraftOutcome<GuestRequestDraftField> {
  // startGuestRequest типизирован общим AdvanceResult, но всегда возвращает обращение.
  const base = current?.flow === "guest_request" ? current : (startGuestRequest(env).state as GuestRequestState);
  const data: GuestRequestData = { ...base.data };
  const accepted: GuestRequestDraftField[] = [];
  const errors: Partial<Record<GuestRequestDraftField, DraftError>> = {};

  if (input.kind !== undefined) {
    if (isKind(input.kind)) {
      data.kind = input.kind;
      accepted.push("kind");
    } else errors.kind = "bad_kind";
  }
  if (input.text !== undefined) {
    const v = validateRequestText(input.text);
    if (v.ok) {
      data.text = v.value;
      accepted.push("text");
    } else errors.text = v.error;
  }
  // «Мой Telegram» и защита от шаблонного ника — agentContact.ts.
  const contact = resolveAgentContact(input, env);
  if (contact.kind === "ok") {
    data.contact = contact.value;
    accepted.push("contact");
  } else if (contact.kind === "error") errors.contact = contact.error;
  // Пропуск контакта (null), сделанный кнопкой, недопустим, если тип сменился на вопрос менеджеру.
  if (data.contact === null && isContactRequired(data.kind)) delete data.contact;

  const step: GuestRequestStep = !data.kind ? "kind" : data.text === undefined ? "text" : data.contact === undefined ? "contact" : "confirm";
  // Поправка на карточке: изменённые пункты помечаются ✏️ (как у брони, см. bookingDraft.ts).
  const onCard = base.step === "confirm" || base.step === "edit";
  const settled = settleGuestRequest({ ...base, step, data, touchedAt: env.now.toISOString() });
  const state = settled.state;
  const changed = base.editFrom ? settled.changed : onCard && step === "confirm" ? changedGuestRequestFields(base.data, data) : [];
  const missing: GuestRequestDraftField[] = [];
  if (!data.kind) missing.push("kind");
  if (data.text === undefined) missing.push("text");
  if (data.contact === undefined) missing.push("contact");

  return { result: { state, reply: { screen: guestRequestScreen(state, env, changed) } }, accepted, errors, missing };
}
