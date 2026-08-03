import { describe, expect, it } from "vitest";
import {
  parseEvaluationInterval,
  parseForDuration,
  parseWindow,
} from "./window";

describe("parseWindow", () => {
  it("parses supported units into seconds and rejects malformed values", () => {
    expect(parseWindow("30s")).toBe(30);
    expect(parseWindow("5m")).toBe(300);
    expect(parseWindow("2h")).toBe(7200);
    expect(parseWindow("1d")).toBe(86400);

    for (const bad of [
      "",
      "5",
      "m",
      "5 m",
      "5mo",
      "-5m",
      "5.5m",
      `${"9".repeat(400)}d`,
    ]) {
      expect(() => parseWindow(bad)).toThrow();
    }
  });
});

describe("parseForDuration", () => {
  it("accepts zero (fire immediately) unlike windows, and names itself in errors", () => {
    expect(parseForDuration("0s")).toBe(0);
    expect(parseForDuration("0m")).toBe(0);
    expect(parseForDuration("90s")).toBe(90);
    expect(parseForDuration("1d")).toBe(86400);
    expect(() => parseWindow("0s")).toThrow(/positive/);

    for (const bad of ["", "5", "5 m", "5mo", "-5m"]) {
      expect(() => parseForDuration(bad)).toThrow(/invalid for duration/);
    }
  });
});

describe("parseEvaluationInterval", () => {
  it("enforces the 1m minimum", () => {
    expect(parseEvaluationInterval("1m")).toBe(60);
    expect(() => parseEvaluationInterval("30s")).toThrow(/at least 1m/);
  });
});
