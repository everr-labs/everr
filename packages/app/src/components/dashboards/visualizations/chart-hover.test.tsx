import { describe, expect, it } from "vitest";
import {
  markerTolerance,
  nearestSeriesKeys,
  valueAtCursorY,
} from "./chart-hover";

// A 202px plot over a 0..100 axis.
const TOL = markerTolerance(202, 100);

const at = (...values: (number | null)[]) =>
  values.map((value, i) => ({ key: `s${i}`, value }));

describe("nearestSeriesKeys", () => {
  it("returns every series tied at the same value, not an arbitrary one", () => {
    const keys = nearestSeriesKeys(at(0, 0, 100, 100), 4, TOL);
    expect([...keys]).toEqual(["s0", "s1"]);
  });

  it("counts a series as tied when its marker would overlap the nearest", () => {
    expect([...nearestSeriesKeys(at(50, 52), 50, TOL)]).toEqual(["s0", "s1"]);
    expect([...nearestSeriesKeys(at(50, 60), 50, TOL)]).toEqual(["s0"]);
  });

  it("never picks a series that has no measurement at this instant", () => {
    expect([...nearestSeriesKeys(at(null, 80), 10, TOL)]).toEqual(["s1"]);
    expect(nearestSeriesKeys(at(null, null), 10, TOL).size).toBe(0);
  });

  it("highlights nothing when the cursor height is unknown", () => {
    expect(nearestSeriesKeys(at(0, 100), null, TOL).size).toBe(0);
  });

  it("highlights the only series there is, so a single line still reads", () => {
    expect([...nearestSeriesKeys(at(58), 12, TOL)]).toEqual(["s0"]);
  });
});

describe("markerTolerance", () => {
  it("scales with the axis, so the tie stays the same distance on screen", () => {
    expect(markerTolerance(202, 1000)).toBeCloseTo(
      markerTolerance(202, 100) * 10,
    );
  });

  it("is zero for a plot with no height, rather than infinite", () => {
    expect(markerTolerance(0, 100)).toBe(0);
  });
});

describe("valueAtCursorY", () => {
  const plot = { top: 8, height: 202 };

  it("maps the plot boundaries to the domain boundaries", () => {
    expect(valueAtCursorY(8, plot, [0, 100])).toBe(100);
    expect(valueAtCursorY(210, plot, [0, 100])).toBe(0);
  });

  it("is linear in between, and handles a domain that is not 0-based", () => {
    expect(valueAtCursorY(109, plot, [0, 100])).toBeCloseTo(50);
    expect(valueAtCursorY(109, plot, [200, 400])).toBeCloseTo(300);
  });

  it("gives up rather than guessing when the pointer height is missing", () => {
    // Recharts omits chartY on some events.
    expect(valueAtCursorY(undefined, plot, [0, 100])).toBeNull();
    expect(valueAtCursorY(50, { top: 0, height: 0 }, [0, 100])).toBeNull();
  });
});
