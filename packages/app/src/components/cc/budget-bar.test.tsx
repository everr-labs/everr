// The budget readout prints a number at every depth, including past zero.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CcBudgetBar, ccFmtBudgetRemaining } from "./budget-bar";

describe("ccFmtBudgetRemaining", () => {
  it("leaves a healthy budget exactly as it was: two decimals", () => {
    expect(ccFmtBudgetRemaining(1)).toBe("100.00%");
    expect(ccFmtBudgetRemaining(0.5)).toBe("50.00%");
    expect(ccFmtBudgetRemaining(0.0234)).toBe("2.34%");
    expect(ccFmtBudgetRemaining(0)).toBe("0.00%");
  });

  it("keeps two decimals for a shallow overspend, where they still mean something", () => {
    expect(ccFmtBudgetRemaining(-0.004)).toBe("-0.40%");
    expect(ccFmtBudgetRemaining(-0.125)).toBe("-12.50%");
    expect(ccFmtBudgetRemaining(-0.999)).toBe("-99.90%");
  });

  it("drops the decimals once the budget is more than fully overspent", () => {
    expect(ccFmtBudgetRemaining(-1)).toBe("-100%");
    expect(ccFmtBudgetRemaining(-1.52)).toBe("-152%");
    expect(ccFmtBudgetRemaining(-9.99)).toBe("-999%");
  });

  it("goes compact past a thousandfold", () => {
    // The case the old code refused to print: "-99900.00%" as five characters.
    expect(ccFmtBudgetRemaining(-999)).toBe("-99.9k%");
    expect(ccFmtBudgetRemaining(-10)).toBe("-1.0k%");
    expect(ccFmtBudgetRemaining(-1234)).toBe("-123.4k%");
  });
});

// Only what the component adds on top of the formatter; the bands are covered
// above.
describe("CcBudgetBar", () => {
  it("shows an em dash for an unknown budget", () => {
    render(<CcBudgetBar remaining={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
