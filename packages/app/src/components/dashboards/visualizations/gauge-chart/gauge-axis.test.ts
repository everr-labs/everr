import { describe, expect, it } from "vitest";
import type { ThresholdsSpec } from "../stat-chart/stat-calculations";
import {
  axisFraction,
  bandColors,
  fillSegments,
  thresholdMarks,
} from "./gauge-axis";

const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const RED = "#ef4444";

const absolute: ThresholdsSpec = {
  mode: "absolute",
  defaultColor: GREEN,
  steps: [
    { value: 50, color: AMBER },
    { value: 80, color: RED },
  ],
};

describe("axisFraction", () => {
  it("measures from the min end", () => {
    expect(axisFraction(25, 0, 100)).toBe(0.25);
  });

  it("flips for inverted bounds", () => {
    expect(axisFraction(20, 100, 0)).toBe(0.8);
  });

  it("clamps outside the bounds", () => {
    expect(axisFraction(-10, 0, 100)).toBe(0);
    expect(axisFraction(150, 0, 100)).toBe(1);
  });

  it("returns 0 for a degenerate axis", () => {
    expect(axisFraction(5, 5, 5)).toBe(0);
  });
});

describe("thresholdMarks", () => {
  it("projects absolute steps and sorts along the axis", () => {
    expect(thresholdMarks(absolute, 0, 100)).toEqual([
      { fraction: 0.5, text: "50", color: AMBER },
      { fraction: 0.8, text: "80", color: RED },
    ]);
  });

  it("projects percent steps against thresholds.max", () => {
    const percent: ThresholdsSpec = {
      mode: "percent",
      max: 200,
      steps: [{ value: 50, color: RED }],
    };
    expect(thresholdMarks(percent, 0, 400)).toEqual([
      { fraction: 0.25, text: "100", color: RED },
    ]);
  });

  it("suffixes the unit on the label", () => {
    expect(thresholdMarks(absolute, 0, 100, "ms")[0]?.text).toBe("50ms");
  });

  it("drops steps outside the axis span, inverted bounds included", () => {
    expect(thresholdMarks(absolute, 0, 40)).toEqual([]);
    expect(thresholdMarks(absolute, 100, 0).map((m) => m.fraction)).toEqual([
      0.2, 0.5,
    ]);
  });

  it("keeps colorless steps as band edges", () => {
    const marks = thresholdMarks(
      { mode: "absolute", steps: [{ value: 50 }] },
      0,
      100,
    );
    expect(marks).toEqual([{ fraction: 0.5, text: "50", color: undefined }]);
  });

  it("returns nothing without steps", () => {
    expect(thresholdMarks(undefined, 0, 100)).toEqual([]);
  });
});

describe("bandColors", () => {
  it("resolves one color per band", () => {
    const marks = thresholdMarks(absolute, 0, 100);
    expect(bandColors(marks, absolute, 0, 100, "fallback")).toEqual([
      GREEN,
      AMBER,
      RED,
    ]);
  });

  it("mirrors the bands for inverted bounds", () => {
    const marks = thresholdMarks(absolute, 100, 0);
    expect(bandColors(marks, absolute, 100, 0, "fallback")).toEqual([
      RED,
      AMBER,
      GREEN,
    ]);
  });

  it("falls back when no threshold resolves", () => {
    expect(bandColors([], undefined, 0, 100, "fallback")).toEqual(["fallback"]);
  });
});

describe("fillSegments", () => {
  const marks = thresholdMarks(absolute, 0, 100);
  const colors = bandColors(marks, absolute, 0, 100, "fallback");

  it("splits the fill at every crossed threshold", () => {
    expect(fillSegments(0.9, marks, colors)).toEqual([
      { from: 0, to: 0.5, color: GREEN },
      { from: 0.5, to: 0.8, color: AMBER },
      { from: 0.8, to: 0.9, color: RED },
    ]);
  });

  it("stops at the value, leaving later bands unfilled", () => {
    expect(fillSegments(0.3, marks, colors)).toEqual([
      { from: 0, to: 0.3, color: GREEN },
    ]);
  });

  it("returns nothing for an empty gauge", () => {
    expect(fillSegments(0, marks, colors)).toEqual([]);
  });
});
