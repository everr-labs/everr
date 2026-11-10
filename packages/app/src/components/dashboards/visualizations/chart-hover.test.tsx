import { describe, expect, it } from "vite-plus/test";
import { markerTolerance, nearestSeriesKeys, valueAtCursorY } from "./chart-hover";

// A 202px plot over a 0..100 axis.
const TOL = markerTolerance(202, 100);

const at = (...values: (number | null)[]) => values.map((value, i) => ({ key: `s${i}`, value }));

describe("nearestSeriesKeys", () => {
  it.each([
    // Every tied series, not an arbitrary one.
    ["the series tied nearest", at(0, 0, 100, 100), 4, ["s0", "s1"]],
    ["a series whose marker would overlap the nearest", at(50, 52), 50, ["s0", "s1"]],
    ["only the nearest when the next is clear of it", at(50, 60), 50, ["s0"]],
    ["never a series with no measurement here", at(null, 80), 10, ["s1"]],
    ["nothing when no series has a measurement", at(null, null), 10, []],
    ["nothing while the cursor height is unknown", at(0, 100), null, []],
    // So a single line still reads.
    ["the only series there is, however far", at(58), 12, ["s0"]],
  ])("picks %s", (_, series, cursor, expected) => {
    expect([...nearestSeriesKeys(series, cursor, TOL)]).toEqual(expected);
  });
});

describe("markerTolerance", () => {
  it("scales with the axis, so the tie stays the same distance on screen", () => {
    expect(markerTolerance(202, 1000)).toBeCloseTo(markerTolerance(202, 100) * 10);
    // Zero rather than infinite while the plot has no height.
    expect(markerTolerance(0, 100)).toBe(0);
  });
});

describe("valueAtCursorY", () => {
  const plot = { top: 8, height: 202 };

  it.each([
    ["the plot's top to the domain's top", 8, [0, 100], 100],
    ["the plot's bottom to the domain's bottom", 210, [0, 100], 0],
    ["linearly in between", 109, [0, 100], 50],
    ["onto a domain that is not 0-based", 109, [200, 400], 300],
  ] as const)("maps %s", (_, y, domain, expected) => {
    expect(valueAtCursorY(y, plot, [...domain])).toBeCloseTo(expected);
  });

  it("gives up rather than guessing while the plot has no height", () => {
    expect(valueAtCursorY(50, { top: 0, height: 0 }, [0, 100])).toBeNull();
  });
});
