import { describe, expect, it } from "vitest";
import type { InstanceValuePoint } from "@/data/alerting/triage/view";
import {
  BREACHING,
  instanceRowsAt,
  nearestPoint,
  printValue,
  QUIET,
  tooltipTime,
} from "./chart-crosshair";

/**
 * The scrubbing the state chart and the instance chart now share. A mistake
 * here shows in both, so it is worth pinning away from either of them.
 *
 * Everything is in minutes before the end of the window, which is how the
 * server hands the readings over.
 */

const point = (
  overrides: Partial<InstanceValuePoint> & { at: number },
): InstanceValuePoint => ({
  value: 50,
  low: 50,
  high: 50,
  breaching: false,
  ...overrides,
});

const series = (fingerprint: string, points: InstanceValuePoint[]) => ({
  fingerprint,
  labels: `host=${fingerprint}`,
  points,
});

describe("the reading under the pointer", () => {
  it("takes the closest reading, not the one the pointer landed on", () => {
    const points = [point({ at: 30 }), point({ at: 10 }), point({ at: 5 })];

    // Buckets are sparse: nothing sits at 12, and 10 is nearer than 5.
    expect(nearestPoint(points, 12)?.at).toBe(10);
    expect(nearestPoint(points, 7)?.at).toBe(5);
    expect(nearestPoint(points, 100)?.at).toBe(30);
  });

  it("gives back nothing for an Alert instance with no readings", () => {
    expect(nearestPoint([], 10)).toBeNull();
  });

  it("ignores a reading older than the window the chart is drawing", () => {
    const points = [point({ at: 500 }), point({ at: 20 })];

    expect(nearestPoint(points, 400, 60)?.at).toBe(20);
    // Every reading is outside the window, so there is nothing to report.
    expect(nearestPoint([point({ at: 500 })], 400, 60)).toBeNull();
  });

  it("keeps the first of two readings the same distance away", () => {
    const points = [point({ at: 10, value: 1 }), point({ at: 20, value: 2 })];

    expect(nearestPoint(points, 15)?.value).toBe(1);
  });
});

describe("the instant the tooltip names", () => {
  it("prints a clock time, not a distance", () => {
    const windowTo = new Date("2026-08-21T12:00:00Z").getTime();

    expect(tooltipTime(windowTo, 30)).toBe(
      new Date("2026-08-21T11:30:00Z").toLocaleString(),
    );
  });

  it("stands at the window's own end for a distance of nothing", () => {
    const windowTo = new Date("2026-08-21T12:00:00Z").getTime();

    expect(tooltipTime(windowTo, 0)).toBe(new Date(windowTo).toLocaleString());
  });
});

describe("the value the tooltip prints", () => {
  it("keeps a whole number whole and rounds a long one", () => {
    expect(printValue(42)).toBe("42");
    expect(printValue(412.38176)).toBe("412.4");
    expect(printValue(1.23456)).toBe("1.23");
  });

  it("falls back to the raw number when the formatter has nothing to say", () => {
    expect(printValue(Number.NaN)).toBe("NaN");
    expect(printValue(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("every Alert instance at one instant", () => {
  it("names all of them, so one can be read against the others", () => {
    const rows = instanceRowsAt(
      [
        series("a", [point({ at: 10, value: 90 })]),
        series("b", [point({ at: 10, value: 20 })]),
      ],
      10,
      60,
    );

    expect(rows.map((row) => [row.key, row.label, row.value])).toEqual([
      ["a", "host=a", "90"],
      ["b", "host=b", "20"],
    ]);
  });

  it("carries the engine's own Condition verdict, not a re-run of it", () => {
    const rows = instanceRowsAt(
      [
        series("breaching", [point({ at: 10, value: 1, breaching: true })]),
        series("quiet", [point({ at: 10, value: 999, breaching: false })]),
      ],
      10,
      60,
    );

    // The higher number is the quiet one: only the engine knows which way the
    // Condition points.
    expect(rows[0]).toMatchObject({ color: BREACHING, active: true });
    expect(rows[1]).toMatchObject({ color: QUIET });
    expect(rows[1].active).toBeFalsy();
  });

  it("says so for an Alert instance that measured nothing in the window", () => {
    const rows = instanceRowsAt([series("gone", [])], 10, 60);

    expect(rows[0]).toMatchObject({
      key: "gone",
      label: "host=gone",
      value: "not evaluated",
      color: QUIET,
    });
  });

  it("says so for an Alert instance whose only reading is older than the window", () => {
    const rows = instanceRowsAt(
      [series("stale", [point({ at: 500 })])],
      10,
      60,
    );

    expect(rows[0].value).toBe("not evaluated");
  });
});
