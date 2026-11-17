import { describe, expect, it } from "vitest";
import { GUEST_REQUEST_STATUSES, allowedGuestRequestActions } from "./guestRequestStatus";

describe("allowedGuestRequestActions", () => {
  it("new: взять в работу или сразу решить", () => {
    expect(allowedGuestRequestActions("new").map((a) => a.to)).toEqual(["in_progress", "resolved"]);
  });
  it("in_progress: решить", () => {
    expect(allowedGuestRequestActions("in_progress").map((a) => a.to)).toEqual(["resolved"]);
  });
  it("resolved: вернуть в работу", () => {
    expect(allowedGuestRequestActions("resolved")).toEqual([{ to: "in_progress", label: "Вернуть в работу" }]);
  });
  it("никогда не предлагает переход в тот же статус", () => {
    for (const status of GUEST_REQUEST_STATUSES) {
      expect(allowedGuestRequestActions(status).some((a) => a.to === status)).toBe(false);
    }
  });
});
