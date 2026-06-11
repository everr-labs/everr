import { describe, expect, it } from "vitest";
import { parseEvaluationInterval, parseWindow } from "./window";

describe("parseWindow", () => {
  it("parses supported units into seconds", () => {
    expect(parseWindow("30s")).toBe(30);
    expect(parseWindow("5m")).toBe(300);
    expect(parseWindow("2h")).toBe(7200);
    expect(parseWindow("1d")).toBe(86400);
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "5", "m", "5 m", "5mo", "-5m", "5.5m"]) {
      expect(() => parseWindow(bad)).toThrow();
    }
  });
});

describe("parseEvaluationInterval", () => {
  it("enforces the 1m minimum", () => {
    expect(parseEvaluationInterval("1m")).toBe(60);
    expect(() => parseEvaluationInterval("30s")).toThrow(/at least 1m/);
  });
});
