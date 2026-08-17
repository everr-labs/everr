import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ruleQueries } from "./queries";

vi.mock("./server", () => ({
  getAlertingRule: vi.fn(),
  getAlertingRuleByName: vi.fn(),
  getAlertingRuleEvaluationSeries: vi.fn(),
  listAlertingRules: vi.fn(),
}));

describe("the rules list across preview scopes", () => {
  it("invalidates every scope from the family key", async () => {
    const qc = new QueryClient();
    qc.setQueryData(ruleQueries.rules().queryKey, []);
    qc.setQueryData(ruleQueries.rules("pr-1").queryKey, []);

    await qc.invalidateQueries({ queryKey: ruleQueries.rulesFamily });

    expect(qc.getQueryState(ruleQueries.rules().queryKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      qc.getQueryState(ruleQueries.rules("pr-1").queryKey)?.isInvalidated,
    ).toBe(true);
  });

  it("cannot reach a sibling scope from one scope's own key", async () => {
    // Pausing a rule changes it in every scope that lists it, which is why the
    // pause mutations invalidate the family rather than the scope they read.
    // A key carrying one scope compares that scope, so it stops at its own.
    const qc = new QueryClient();
    qc.setQueryData(ruleQueries.rules().queryKey, []);
    qc.setQueryData(ruleQueries.rules("pr-1").queryKey, []);

    await qc.invalidateQueries({ queryKey: ruleQueries.rules().queryKey });

    expect(
      qc.getQueryState(ruleQueries.rules("pr-1").queryKey)?.isInvalidated,
    ).toBe(false);
  });
});
