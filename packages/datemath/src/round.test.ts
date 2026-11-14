import { describe, expect, it } from "vite-plus/test";
import { roundDate } from "./round.js";

// Sunday, 2025-06-15 14:30:45.123; its week runs from Monday June 9.
const BASE = new Date(2025, 5, 15, 14, 30, 45, 123);

describe.each([
  [
    "down",
    false,
    [
      ["s", new Date(2025, 5, 15, 14, 30, 45, 0)],
      ["m", new Date(2025, 5, 15, 14, 30, 0, 0)],
      ["h", new Date(2025, 5, 15, 14, 0, 0, 0)],
      ["d", new Date(2025, 5, 15, 0, 0, 0, 0)],
      ["w", new Date(2025, 5, 9, 0, 0, 0, 0)],
      ["M", new Date(2025, 5, 1, 0, 0, 0, 0)],
      ["y", new Date(2025, 0, 1, 0, 0, 0, 0)],
    ],
  ],
  [
    "up",
    true,
    [
      ["s", new Date(2025, 5, 15, 14, 30, 45, 999)],
      ["m", new Date(2025, 5, 15, 14, 30, 59, 999)],
      ["h", new Date(2025, 5, 15, 14, 59, 59, 999)],
      ["d", new Date(2025, 5, 15, 23, 59, 59, 999)],
      ["w", new Date(2025, 5, 15, 23, 59, 59, 999)],
      ["M", new Date(2025, 5, 30, 23, 59, 59, 999)],
      ["y", new Date(2025, 11, 31, 23, 59, 59, 999)],
    ],
  ],
] as const)("roundDate - round %s", (_, roundUp, cases) => {
  it.each(cases)("to %s", (unit, expected) => {
    expect(roundDate(BASE, unit, roundUp)).toEqual(expected);
  });
});

describe("roundDate - edge cases", () => {
  it.each([
    [
      "a Monday down to its own start",
      new Date(2025, 5, 9, 10, 0, 0, 0),
      "w",
      false,
      new Date(2025, 5, 9, 0, 0, 0, 0),
    ],
    [
      "a Saturday down to the previous Monday",
      new Date(2025, 5, 14, 12, 0, 0, 0),
      "w",
      false,
      new Date(2025, 5, 9, 0, 0, 0, 0),
    ],
    [
      "February up in a leap year",
      new Date(2024, 1, 15, 12, 0, 0, 0),
      "M",
      true,
      new Date(2024, 1, 29, 23, 59, 59, 999),
    ],
    [
      "February up in a non-leap year",
      new Date(2025, 1, 15, 12, 0, 0, 0),
      "M",
      true,
      new Date(2025, 1, 28, 23, 59, 59, 999),
    ],
    [
      "a 31-day month up",
      new Date(2025, 0, 15, 12, 0, 0, 0),
      "M",
      true,
      new Date(2025, 0, 31, 23, 59, 59, 999),
    ],
  ] as const)("rounds %s", (_, date, unit, roundUp, expected) => {
    expect(roundDate(date, unit, roundUp)).toEqual(expected);
  });

  it("does not mutate the input date", () => {
    const original = new Date(BASE.getTime());
    roundDate(BASE, "d", false);
    expect(BASE.getTime()).toBe(original.getTime());
  });
});
