import { describe, expect, it } from "vitest";
import { isWithinDashboardPath } from "./dashboard-paths";

describe("isWithinDashboardPath", () => {
  const prefix = "/dashboards/prod";

  it("matches the dashboard route itself", () => {
    expect(isWithinDashboardPath("/dashboards/prod", prefix)).toBe(true);
  });

  it("matches child routes (settings, panel editor)", () => {
    expect(isWithinDashboardPath("/dashboards/prod/settings", prefix)).toBe(
      true,
    );
    expect(isWithinDashboardPath("/dashboards/prod/panel/p1", prefix)).toBe(
      true,
    );
  });

  it("does not match a sibling slug that shares the prefix", () => {
    expect(isWithinDashboardPath("/dashboards/prod-copy", prefix)).toBe(false);
    expect(isWithinDashboardPath("/dashboards/production", prefix)).toBe(false);
  });

  it("does not match the dashboards list or another dashboard", () => {
    expect(isWithinDashboardPath("/dashboards", prefix)).toBe(false);
    expect(isWithinDashboardPath("/dashboards/other", prefix)).toBe(false);
  });
});
