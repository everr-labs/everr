import { describe, expect, it } from "vitest";
import { dashboardFromResource } from "./normalize";
import type { DashboardResource } from "./schema";
import { dashboardTimeDefaults } from "./time-defaults";

describe("dashboardTimeDefaults", () => {
  it("uses an explicit time range", () => {
    expect(
      dashboardTimeDefaults({ timeRange: { from: "now/M", to: "now" } }),
    ).toEqual({ from: "now/M", to: "now" });
  });

  it("ignores an invalid time range", () => {
    expect(
      dashboardTimeDefaults({ timeRange: { from: "banana", to: "now" } }),
    ).toBeUndefined();
  });

  it("derives refresh from a supported refreshInterval", () => {
    expect(dashboardTimeDefaults({ refreshInterval: "30s" })).toEqual({
      refresh: "30s",
    });
  });

  it("ignores an unsupported refreshInterval", () => {
    expect(dashboardTimeDefaults({ refreshInterval: "2h" })).toBeUndefined();
  });

  it("derives both together", () => {
    expect(
      dashboardTimeDefaults({
        timeRange: { from: "now-6h", to: "now" },
        refreshInterval: "1m",
      }),
    ).toEqual({ from: "now-6h", to: "now", refresh: "1m" });
  });

  it("returns undefined when the spec declares nothing", () => {
    expect(dashboardTimeDefaults({})).toBeUndefined();
  });
});

describe("dashboardFromResource", () => {
  function resource(
    time: Pick<DashboardResource["spec"], "duration" | "timeRange">,
  ): DashboardResource {
    return {
      kind: "Dashboard",
      metadata: { name: "requests" },
      spec: { panels: {}, layouts: [], ...time },
    };
  }

  it("normalizes a Perses duration to an Everr time range", () => {
    const dashboard = dashboardFromResource(resource({ duration: "1h" }));

    expect(dashboard.spec.timeRange).toEqual({ from: "now-1h", to: "now" });
    expect(dashboard.spec).not.toHaveProperty("duration");
  });

  it("prefers an explicit Everr time range over a Perses duration", () => {
    const dashboard = dashboardFromResource(
      resource({
        timeRange: { from: "now/M", to: "now" },
        duration: "31d",
      }),
    );

    expect(dashboard.spec.timeRange).toEqual({ from: "now/M", to: "now" });
  });

  it("falls back to duration when the explicit range is invalid", () => {
    const dashboard = dashboardFromResource(
      resource({
        timeRange: { from: "banana", to: "now" },
        duration: "7d",
      }),
    );

    expect(dashboard.spec.timeRange).toEqual({ from: "now-7d", to: "now" });
  });
});
