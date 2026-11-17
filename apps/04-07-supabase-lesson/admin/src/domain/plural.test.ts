import { describe, expect, it } from "vitest";
import { guestsLabel } from "./plural";

describe("guestsLabel", () => {
  it.each([
    [1, "1 гость"],
    [2, "2 гостя"],
    [4, "4 гостя"],
    [5, "5 гостей"],
    [11, "11 гостей"],
    [12, "12 гостей"],
    [21, "21 гость"],
    [22, "22 гостя"],
    [20, "20 гостей"],
  ])("%i → %s", (n, expected) => {
    expect(guestsLabel(n)).toBe(expected);
  });
});
