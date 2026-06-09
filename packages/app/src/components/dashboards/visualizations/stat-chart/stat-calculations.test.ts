import { describe, expect, it } from "vitest";
import {
  calculate,
  formatStatValue,
  resolveThresholdColor,
} from "./stat-calculations";

describe("calculate", () => {
  const values = [4, 2, 8, 6];

  it("last", () => expect(calculate(values, "last")).toBe(6));
  it("first", () => expect(calculate(values, "first")).toBe(4));
  it("mean", () => expect(calculate(values, "mean")).toBe(5));
  it("min", () => expect(calculate(values, "min")).toBe(2));
  it("max", () => expect(calculate(values, "max")).toBe(8));
  it("sum", () => expect(calculate(values, "sum")).toBe(20));
  it("returns undefined for an empty series", () => {
    expect(calculate([], "last")).toBeUndefined();
  });
});

describe("resolveThresholdColor", () => {
  const thresholds = {
    mode: "absolute" as const,
    defaultColor: "#888888",
    steps: [
      { value: 50, color: "#eab308" },
      { value: 80, color: "#ef4444" },
    ],
  };

  it("returns undefined when no thresholds configured", () => {
    expect(resolveThresholdColor(10, undefined, 100)).toBeUndefined();
  });

  it("returns defaultColor below all steps", () => {
    expect(resolveThresholdColor(10, thresholds, 100)).toBe("#888888");
  });

  it("picks the highest crossed step (absolute mode)", () => {
    expect(resolveThresholdColor(60, thresholds, 100)).toBe("#eab308");
    expect(resolveThresholdColor(80, thresholds, 100)).toBe("#ef4444");
    expect(resolveThresholdColor(999, thresholds, 100)).toBe("#ef4444");
  });

  it("sorts steps before evaluating", () => {
    const unsorted = {
      ...thresholds,
      steps: [
        { value: 80, color: "#ef4444" },
        { value: 50, color: "#eab308" },
      ],
    };
    expect(resolveThresholdColor(60, unsorted, 100)).toBe("#eab308");
  });

  it("percent mode evaluates relative to the series max", () => {
    const pct = { ...thresholds, mode: "percent" as const };
    // value 30 of max 50 → 60% → crosses the 50 step
    expect(resolveThresholdColor(30, pct, 50)).toBe("#eab308");
    // value 45 of max 50 → 90% → crosses the 80 step
    expect(resolveThresholdColor(45, pct, 50)).toBe("#ef4444");
    // value 10 of max 50 → 20% → below all steps
    expect(resolveThresholdColor(10, pct, 50)).toBe("#888888");
  });

  it("percent mode with zero max falls back to defaultColor", () => {
    const pct = { ...thresholds, mode: "percent" as const };
    expect(resolveThresholdColor(0, pct, 0)).toBe("#888888");
  });
});

describe("formatStatValue", () => {
  it("limits to two fraction digits", () => {
    // compare against toLocaleString so the test is locale-independent
    expect(formatStatValue(Math.PI)).toBe((3.14).toLocaleString());
  });
  it("groups thousands", () => {
    expect(formatStatValue(1234567)).toBe((1234567).toLocaleString());
  });
});
