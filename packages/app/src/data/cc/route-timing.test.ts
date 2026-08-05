import { describe, expect, it } from "vitest";
import { type CcRouteTiming, ccRouteTimingSummary } from "./route-timing";

const timing = (groupBy: string[] | null): CcRouteTiming => ({
  groupBy,
  groupWaitSecs: null,
  groupIntervalSecs: null,
  repeatIntervalSecs: null,
});

describe("ccRouteTimingSummary grouping", () => {
  it("keeps automatic grouping distinct from an explicit empty grouping", () => {
    expect(ccRouteTimingSummary(timing(null), "effective")).toContain(
      "group automatically",
    );
    expect(ccRouteTimingSummary(timing([]), "effective")).toContain(
      "one group",
    );
  });

  it("names explicit grouping labels", () => {
    expect(
      ccRouteTimingSummary(timing(["rule", "severity"]), "effective"),
    ).toContain("group by rule, severity");
  });

  it("only shows explicit grouping in an overrides summary", () => {
    expect(ccRouteTimingSummary(timing(null), "overrides")).toEqual([]);
    expect(ccRouteTimingSummary(timing([]), "overrides")).toEqual([
      "one group",
    ]);
  });
});
