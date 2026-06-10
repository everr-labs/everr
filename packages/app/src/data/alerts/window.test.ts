import { describe, expect, it } from "vitest";
import { parseEvaluationInterval, parseWindow } from "./window";

describe("parseWindow", () => {
  it("parses supported units into seconds and ClickHouse interval fragments", () => {
    expect(parseWindow("30s")).toEqual({ seconds: 30, interval: "30 SECOND" });
    expect(parseWindow("5m")).toEqual({ seconds: 300, interval: "5 MINUTE" });
    expect(parseWindow("2h")).toEqual({ seconds: 7200, interval: "2 HOUR" });
    expect(parseWindow("1d")).toEqual({ seconds: 86400, interval: "1 DAY" });
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "5", "m", "5 m", "5mo", "-5m", "5.5m"]) {
      expect(() => parseWindow(bad)).toThrow();
    }
  });
});

describe("parseEvaluationInterval", () => {
  it("enforces the 1m minimum", () => {
    expect(parseEvaluationInterval("1m").seconds).toBe(60);
    expect(() => parseEvaluationInterval("30s")).toThrow(/at least 1m/);
  });
});
