import { describe, expect, it } from "vitest";
import {
  markerTolerance,
  nearestSeriesKeys,
  valueAtCursorY,
} from "./chart-hover";

// A 202px plot over a 0..100 axis, the SLO budget chart's geometry: a pixel is
// about half a unit, so the tie distance lands near 3.
const TOL = markerTolerance(202, 100);

const at = (...values: (number | null)[]) =>
  values.map((value, i) => ({ key: `s${i}`, value }));

describe("nearestSeriesKeys", () => {
  it("returns every series tied at the same value, not an arbitrary one", () => {
    // The case the highlight exists for: two groups on the exhausted floor and
    // two at a full budget. Pointing near the floor must name BOTH of the
    // groups sitting there, or it hides exactly the overlap it is resolving.
    const keys = nearestSeriesKeys(at(0, 0, 100, 100), 4, TOL);
    expect([...keys]).toEqual(["s0", "s1"]);
  });

  it("picks the other pair when the pointer moves to them", () => {
    const keys = nearestSeriesKeys(at(0, 0, 100, 100), 96, TOL);
    expect([...keys]).toEqual(["s2", "s3"]);
  });

  it("counts a series as tied when its marker would overlap the nearest", () => {
    // 2 apart is inside the tolerance: the markers visibly touch, so both are
    // called out even though one is strictly closer.
    expect([...nearestSeriesKeys(at(50, 52), 50, TOL)]).toEqual(["s0", "s1"]);
    // 10 apart is not.
    expect([...nearestSeriesKeys(at(50, 60), 50, TOL)]).toEqual(["s0"]);
  });

  it("never picks a series that has no measurement at this instant", () => {
    // A null point is a gap in the line; there is nothing there to point at,
    // however close the cursor happens to be to where it would have been.
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
    // Same plot, an axis spanning 10x more: a tie has to cover 10x the value
    // range to still mean "these markers are touching".
    expect(markerTolerance(202, 1000)).toBeCloseTo(
      markerTolerance(202, 100) * 10,
    );
  });

  it("is zero for a plot with no height, rather than infinite", () => {
    // A chart that has not been laid out yet must not report every series as
    // tied with every other.
    expect(markerTolerance(0, 100)).toBe(0);
  });
});

describe("valueAtCursorY", () => {
  const plot = { top: 8, height: 202 };

  it("reads the top of the plot as the top of the domain", () => {
    expect(valueAtCursorY(8, plot, [0, 100])).toBe(100);
  });

  it("reads the bottom of the plot as the bottom of the domain", () => {
    expect(valueAtCursorY(210, plot, [0, 100])).toBe(0);
  });

  it("is linear in between, and handles a domain that is not 0-based", () => {
    expect(valueAtCursorY(109, plot, [0, 100])).toBeCloseTo(50);
    expect(valueAtCursorY(109, plot, [200, 400])).toBeCloseTo(300);
  });

  it("gives up rather than guessing when the pointer height is missing", () => {
    // recharts omits chartY on some events; a guess here would highlight the
    // wrong series with full confidence.
    expect(valueAtCursorY(undefined, plot, [0, 100])).toBeNull();
    expect(valueAtCursorY(50, { top: 0, height: 0 }, [0, 100])).toBeNull();
  });
});
