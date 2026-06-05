import { describe, expect, it } from "vitest";
import { dashboardSearchDefaults } from "./time-defaults";

describe("dashboardSearchDefaults", () => {
  it("seeds from/to from duration when URL has neither", () => {
    expect(dashboardSearchDefaults({ duration: "1h" }, {})).toEqual({
      from: "now-1h",
      to: "now",
    });
  });

  it("does not seed when from is explicitly set", () => {
    expect(
      dashboardSearchDefaults({ duration: "1h" }, { from: "now-2d" }),
    ).toBeNull();
  });

  it("does not seed when to is explicitly set", () => {
    expect(
      dashboardSearchDefaults({ duration: "1h" }, { to: "now-1d" }),
    ).toBeNull();
  });

  it("ignores an invalid duration", () => {
    expect(dashboardSearchDefaults({ duration: "banana" }, {})).toBeNull();
  });

  it("seeds refresh from a supported refreshInterval", () => {
    expect(dashboardSearchDefaults({ refreshInterval: "30s" }, {})).toEqual({
      refresh: "30s",
    });
  });

  it("ignores an unsupported refreshInterval", () => {
    expect(dashboardSearchDefaults({ refreshInterval: "2h" }, {})).toBeNull();
  });

  it("does not override an explicit refresh param", () => {
    expect(
      dashboardSearchDefaults({ refreshInterval: "30s" }, { refresh: "5s" }),
    ).toBeNull();
  });

  it("seeds both together", () => {
    expect(
      dashboardSearchDefaults({ duration: "6h", refreshInterval: "1m" }, {}),
    ).toEqual({ from: "now-6h", to: "now", refresh: "1m" });
  });

  it("returns null when the spec has no defaults", () => {
    expect(dashboardSearchDefaults({}, {})).toBeNull();
  });
});
