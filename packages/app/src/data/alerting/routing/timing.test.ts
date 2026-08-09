import { describe, expect, it } from "vitest";
import { type AlertingRouteTiming, alertingRouteTimingSummary } from "./timing";

const timing = (groupBy: string[] | null): AlertingRouteTiming => ({
  groupBy,
  groupWaitSecs: null,
  groupIntervalSecs: null,
  repeatIntervalSecs: null,
});

describe("alertingRouteTimingSummary grouping", () => {
  it("keeps automatic grouping distinct from an explicit empty grouping", () => {
    expect(alertingRouteTimingSummary(timing(null), "effective")).toContain(
      "group automatically",
    );
    expect(alertingRouteTimingSummary(timing([]), "effective")).toContain(
      "one group",
    );
  });

  it("names explicit grouping labels", () => {
    expect(
      alertingRouteTimingSummary(timing(["rule", "severity"]), "effective"),
    ).toContain("group by rule, severity");
  });

  it("only shows explicit grouping in an overrides summary", () => {
    expect(alertingRouteTimingSummary(timing(null), "overrides")).toEqual([]);
    expect(alertingRouteTimingSummary(timing([]), "overrides")).toEqual([
      "one group",
    ]);
  });
});
