import { describe, expect, it } from "vitest";
import { ccFmtBudgetRemaining } from "./budget-bar";

describe("ccFmtBudgetRemaining", () => {
  // Precision recedes as the overspend grows: two decimals while they still
  // mean something, whole percent past a full overspend, compact past a
  // thousandfold. Non-negative budgets are left exactly as they were.
  it.each([
    [1, "100.00%"],
    [0.5, "50.00%"],
    [0.0234, "2.34%"],
    [0, "0.00%"],
    [-0.004, "-0.40%"],
    [-0.125, "-12.50%"],
    [-0.999, "-99.90%"],
    [-1, "-100%"],
    [-1.52, "-152%"],
    [-9.99, "-999%"],
    [-10, "-1.0k%"],
    [-999, "-99.9k%"],
    [-1234, "-123.4k%"],
  ])("formats %f as %s", (remaining, expected) => {
    expect(ccFmtBudgetRemaining(remaining)).toBe(expected);
  });
});
