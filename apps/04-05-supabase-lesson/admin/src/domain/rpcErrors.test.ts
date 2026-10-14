import { describe, expect, it } from "vitest";
import { GENERIC_SAVE_ERROR, RPC_ERROR_CODES, rpcErrorText, toRpcErrorCode } from "./rpcErrors";

describe("rpcErrors", () => {
  it("у каждого кода есть своё сообщение, отличное от общего", () => {
    for (const code of RPC_ERROR_CODES) expect(rpcErrorText(code)).not.toBe(GENERIC_SAVE_ERROR);
  });
  it("неизвестный текст и undefined → общее сообщение, сырой текст не просачивается", () => {
    expect(rpcErrorText("permission denied for function set_booking_status")).toBe(GENERIC_SAVE_ERROR);
    expect(rpcErrorText(undefined)).toBe(GENERIC_SAVE_ERROR);
  });
  it("toRpcErrorCode узнаёт только точное совпадение", () => {
    expect(toRpcErrorCode("status_conflict")).toBe("status_conflict");
    expect(toRpcErrorCode("status_conflict: extra")).toBeNull();
  });
});
