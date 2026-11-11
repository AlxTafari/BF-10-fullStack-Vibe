// Черновик обращения от агента (S09, сессия 3, §4.16): «позовите менеджера, мне не понравилось обслуживание» →
// тип и текст из фразы гостя. Ложится в ТОТ ЖЕ GuestRequestState, что у кнопочного сценария S03; контакт — по его
// правилам (для вопроса менеджеру обязателен, для отзыва и жалобы можно пропустить кнопкой). Обращение не создаёт —
// только кнопка гостя «Отправить». Чистая функция.
import { validateContact, validateRequestText } from "./fieldValidation.ts";
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
import { guestRequestScreen, isContactRequired, startGuestRequest } from "./guestRequestFlow.ts";

export interface GuestRequestDraftInput {
  kind?: string;
  text?: string;
  contact?: string;
}

export type GuestRequestDraftField = keyof GuestRequestDraftInput;

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
  if (input.contact !== undefined) {
    const v = validateContact(input.contact);
    if (v.ok) {
      data.contact = v.value;
      accepted.push("contact");
    } else errors.contact = v.error;
  }
  // Пропуск контакта (null), сделанный кнопкой, недопустим, если тип сменился на вопрос менеджеру.
  if (data.contact === null && isContactRequired(data.kind)) delete data.contact;

  const step: GuestRequestStep = !data.kind ? "kind" : data.text === undefined ? "text" : data.contact === undefined ? "contact" : "confirm";
  const state: GuestRequestState = { ...base, step, data, touchedAt: env.now.toISOString() };
  const missing: GuestRequestDraftField[] = [];
  if (!data.kind) missing.push("kind");
  if (data.text === undefined) missing.push("text");
  if (data.contact === undefined) missing.push("contact");

  return { result: { state, reply: { screen: guestRequestScreen(state, env) } }, accepted, errors, missing };
}
