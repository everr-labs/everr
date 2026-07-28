import { describe, expect, it } from "vitest";
import { ccNearestSeries } from "./slo-budget-chart";

// The chart's y axis spans 0..100 over ~202px, so a pixel is about half a
// percentage point. These use a 3pt tolerance, roughly the 6px marker radius
// the chart itself passes.
const TOL = 3;

const at = (...pcts: (number | null)[]) =>
  pcts.map((pct, i) => ({ key: `s${i}`, pct }));

describe("ccNearestSeries", () => {
  it("returns every series tied at the same value, not an arbitrary one", () => {
    // The case the highlight exists for: two groups on the exhausted floor and
    // two at a full budget. Pointing near the floor must name BOTH of the
    // groups sitting there, or it hides exactly the overlap it is resolving.
    const keys = ccNearestSeries(at(0, 0, 100, 100), 4, TOL);
    expect([...keys]).toEqual(["s0", "s1"]);
  });

  it("picks the other pair when the pointer moves to them", () => {
    const keys = ccNearestSeries(at(0, 0, 100, 100), 96, TOL);
    expect([...keys]).toEqual(["s2", "s3"]);
  });

  it("counts a series as tied when its marker would overlap the nearest", () => {
    // 2pt apart is inside the tolerance: the markers visibly touch, so both
    // are called out even though one is strictly closer.
    expect([...ccNearestSeries(at(50, 52), 50, TOL)]).toEqual(["s0", "s1"]);
    // 10pt apart is not.
    expect([...ccNearestSeries(at(50, 60), 50, TOL)]).toEqual(["s0"]);
  });

  it("never picks a series that has no measurement at this instant", () => {
    // A null point is a gap in the line; there is nothing there to point at,
    // however close the cursor happens to be to where it would have been.
    expect([...ccNearestSeries(at(null, 80), 10, TOL)]).toEqual(["s1"]);
    expect(ccNearestSeries(at(null, null), 10, TOL).size).toBe(0);
  });

  it("highlights nothing when the cursor height is unknown", () => {
    expect(ccNearestSeries(at(0, 100), null, TOL).size).toBe(0);
  });

  it("highlights the only series there is, so a scalar SLO still reads", () => {
    expect([...ccNearestSeries(at(58), 12, TOL)]).toEqual(["s0"]);
  });
});
