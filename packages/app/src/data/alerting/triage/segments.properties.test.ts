import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LifecycleEventType, LifecycleRow } from "./segments";
import { ruleStateSegments } from "./segments";

/**
 * The state chart's segments, checked against invariants rather than examples.
 *
 * `segments.test.ts` beside this file pins what a chosen event stream draws.
 * These cases generate streams instead, including ones nobody would think to
 * write: a close with no open, two instances overlapping, a resolve before its
 * fire, a run of failures inside a fire. What must hold for every one of them
 * is that the chart can be drawn: the stretches lie inside the window, they do
 * not overlap, they are in order, and two touching ones never carry the same
 * state, which would draw as one stretch with a seam in it.
 *
 * Coordinates are minutes before the end of the window, so `from` is the older
 * edge and the larger number, and the segments come out newest last.
 */

const MINUTE = 60_000;
const WINDOW_FROM = 0;
const WINDOW_MINUTES = 120;
const WINDOW_TO = WINDOW_MINUTES * MINUTE;
const INTERVAL_MS = 5 * MINUTE;

const EVENT_TYPES: LifecycleEventType[] = [
  "instance_pending",
  "instance_fired",
  "instance_resolved",
  "instance_closed",
  "evaluation_failed",
];

const rowArb: fc.Arbitrary<LifecycleRow> = fc.record({
  fingerprint: fc.constantFrom("a", "b", "c"),
  eventType: fc.constantFrom(...EVENT_TYPES),
  at: fc.integer({ min: WINDOW_FROM, max: WINDOW_TO }),
});

const rowsArb = fc.array(rowArb, { maxLength: 12 });

/** At most one carried-in state for each Alert instance, which is what the
 *  loader gives back. */
const priorArb = fc.uniqueArray(
  fc.record({
    fingerprint: fc.constantFrom("a", "b", "c"),
    eventType: fc.constantFrom(...EVENT_TYPES),
    at: fc.constant(-MINUTE),
  }),
  { maxLength: 3, selector: (row) => row.fingerprint },
);

function segmentsOf(
  rows: LifecycleRow[],
  prior: LifecycleRow[],
  silencedFrom: number | null = null,
) {
  return ruleStateSegments({
    rows,
    prior,
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    intervalMs: INTERVAL_MS,
    silencedFrom,
  });
}

describe("the stretches the state chart paints", () => {
  it("keeps every stretch inside the window", () => {
    fc.assert(
      fc.property(rowsArb, priorArb, (rows, prior) => {
        for (const segment of segmentsOf(rows, prior)) {
          expect(Number.isFinite(segment.from)).toBe(true);
          expect(Number.isFinite(segment.to)).toBe(true);
          expect(segment.to).toBeGreaterThanOrEqual(0);
          expect(segment.from).toBeLessThanOrEqual(WINDOW_MINUTES);
        }
      }),
    );
  });

  it("never paints a stretch with no width", () => {
    fc.assert(
      fc.property(rowsArb, priorArb, (rows, prior) => {
        for (const segment of segmentsOf(rows, prior)) {
          // `from` is the older edge, so it is the larger number.
          expect(segment.from).toBeGreaterThan(segment.to);
        }
      }),
    );
  });

  it("never overlaps two stretches, and gives them oldest first", () => {
    fc.assert(
      fc.property(rowsArb, priorArb, (rows, prior) => {
        const segments = segmentsOf(rows, prior);
        for (let i = 1; i < segments.length; i++) {
          // The previous stretch's newer edge is at or before this one's
          // older edge, which in these coordinates reads as >=.
          expect(segments[i - 1].to).toBeGreaterThanOrEqual(segments[i].from);
        }
      }),
    );
  });

  it("never leaves two touching stretches in the same state", () => {
    fc.assert(
      fc.property(rowsArb, priorArb, (rows, prior) => {
        const segments = segmentsOf(rows, prior);
        for (let i = 1; i < segments.length; i++) {
          if (segments[i - 1].to === segments[i].from) {
            expect(segments[i - 1].state).not.toBe(segments[i].state);
          }
        }
      }),
    );
  });

  it("paints nothing at all when nothing happened", () => {
    expect(segmentsOf([], [])).toEqual([]);
  });
});

describe("what outranks what", () => {
  it("reports Degraded over the minutes a failed evaluation stole, whatever else was going on", () => {
    fc.assert(
      fc.property(
        rowsArb,
        priorArb,
        // Far enough from the window end that the whole stolen interval fits.
        fc.integer({ min: 0, max: WINDOW_TO - INTERVAL_MS }),
        (rows, prior, failedAt) => {
          const withFailure = [
            ...rows,
            {
              fingerprint: "a",
              eventType: "evaluation_failed" as const,
              at: failedAt,
            },
          ];
          // An instant the failure certainly covers, and no later failure can
          // have been generated past the window end.
          const instant = failedAt + INTERVAL_MS / 2;
          const minutesBeforeEnd = (WINDOW_TO - instant) / 60_000;
          const covering = segmentsOf(withFailure, prior).find(
            (segment) =>
              segment.from >= minutesBeforeEnd &&
              segment.to <= minutesBeforeEnd,
          );
          // A rule we cannot evaluate hides an unknown number of Firing
          // instances, so nothing may show through it.
          expect(covering?.state).toBe("degraded");
        },
      ),
    );
  });

  it("never reports Firing under a Silence that covers the whole window", () => {
    fc.assert(
      fc.property(rowsArb, priorArb, (rows, prior) => {
        for (const segment of segmentsOf(rows, prior, WINDOW_FROM)) {
          expect(segment.state).not.toBe("firing");
        }
      }),
    );
  });

  it("leaves Pending alone under a Silence: Pending never delivers", () => {
    fc.assert(
      fc.property(rowsArb, priorArb, (rows, prior) => {
        const quiet = segmentsOf(rows, prior);
        const silenced = segmentsOf(rows, prior, WINDOW_FROM);
        const pendingMinutes = (list: typeof quiet) =>
          list
            .filter((segment) => segment.state === "pending")
            .reduce((total, segment) => total + segment.from - segment.to, 0);
        expect(pendingMinutes(silenced)).toBeCloseTo(pendingMinutes(quiet), 9);
      }),
    );
  });
});
