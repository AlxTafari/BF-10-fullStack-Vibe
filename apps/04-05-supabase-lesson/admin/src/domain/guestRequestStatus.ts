// Статусы обращений. Матрица свободная (как в set_guest_request_status): любой переход между разными статусами.

export const GUEST_REQUEST_STATUSES = ["new", "in_progress", "resolved"] as const;
export type GuestRequestStatus = (typeof GUEST_REQUEST_STATUSES)[number];

export const GUEST_REQUEST_KINDS = ["feedback", "complaint", "manager_request"] as const;
export type GuestRequestKind = (typeof GUEST_REQUEST_KINDS)[number];

export const GUEST_REQUEST_STATUS_LABEL: Record<GuestRequestStatus, string> = {
  new: "Новое",
  in_progress: "В работе",
  resolved: "Решено",
};

export const GUEST_REQUEST_KIND_LABEL: Record<GuestRequestKind, string> = {
  feedback: "Отзыв",
  complaint: "Жалоба",
  manager_request: "Вопрос менеджеру",
};

export interface GuestRequestAction {
  to: GuestRequestStatus;
  label: string;
}

/** Кнопки карточки обращения. Деструктивных переходов нет — подтверждающие диалоги не нужны. */
export function allowedGuestRequestActions(status: GuestRequestStatus): GuestRequestAction[] {
  switch (status) {
    case "new":
      return [
        { to: "in_progress", label: "Взять в работу" },
        { to: "resolved", label: "Решено" },
      ];
    case "in_progress":
      return [{ to: "resolved", label: "Решено" }];
    case "resolved":
      return [{ to: "in_progress", label: "Вернуть в работу" }];
  }
}
