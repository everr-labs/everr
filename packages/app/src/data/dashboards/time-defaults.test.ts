import { describe, expect, it } from "vite-plus/test";
import { dashboardTimeDefaults } from "./time-defaults";

describe("dashboardTimeDefaults", () => {
  it("derives from/to from a valid duration", () => {
    expect(dashboardTimeDefaults({ duration: "1h" })).toEqual({
      from: "now-1h",
      to: "now",
    });
  });

  it("ignores an invalid duration", () => {
    expect(dashboardTimeDefaults({ duration: "banana" })).toBeUndefined();
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
    expect(dashboardTimeDefaults({ duration: "6h", refreshInterval: "1m" })).toEqual({
      from: "now-6h",
      to: "now",
      refresh: "1m",
    });
  });

  it("returns undefined when the spec declares nothing", () => {
    expect(dashboardTimeDefaults({})).toBeUndefined();
  });
});
