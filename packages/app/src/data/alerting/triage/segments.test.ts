import { describe, expect, it } from "vitest";
import { type LifecycleRow, ruleStateSegments } from "./segments";

const MINUTE = 60_000;
const WINDOW_TO = Date.parse("2026-08-21T12:00:00Z");
const WINDOW_FROM = WINDOW_TO - 60 * MINUTE;

/** Minutes before the end of the window, which is what the chart plots. */
function at(minutesAgo: number) {
  return WINDOW_TO - minutesAgo * MINUTE;
}

function segments(
  rows: LifecycleRow[],
  silencedFrom?: number,
  prior?: LifecycleRow[],
) {
  return ruleStateSegments({
    rows,
    prior,
    windowFrom: WINDOW_FROM,
    windowTo: WINDOW_TO,
    intervalMs: MINUTE,
    silencedFrom: silencedFrom ?? null,
  });
}

describe("ruleStateSegments", () => {
  it("turns a pending-then-fired run into two adjacent segments", () => {
    expect(
      segments([
        { fingerprint: "a", eventType: "instance_pending", at: at(30) },
        { fingerprint: "a", eventType: "instance_fired", at: at(25) },
        { fingerprint: "a", eventType: "instance_resolved", at: at(10) },
      ]),
    ).toEqual([
      { state: "pending", from: 30, to: 25 },
      { state: "firing", from: 25, to: 10 },
    ]);
  });

  it("runs an unresolved instance to the end of the window", () => {
    expect(
      segments([{ fingerprint: "a", eventType: "instance_fired", at: at(12) }]),
    ).toEqual([{ state: "firing", from: 12, to: 0 }]);
  });

  it("back-dates a close whose open is older than the window", () => {
    // Only a firing instance resolves, so the stretch before the resolve was
    // firing even though nothing in view says when it started.
    expect(
      segments([
        { fingerprint: "a", eventType: "instance_resolved", at: at(40) },
      ]),
    ).toEqual([{ state: "firing", from: 60, to: 40 }]);
  });

  it("carries a state that started before the window across the whole of it", () => {
    // The rule fired hours ago and has said nothing since: the window holds no
    // events at all, and the chart still has to show it firing.
    expect(
      segments([], undefined, [
        { fingerprint: "a", eventType: "instance_fired", at: at(600) },
      ]),
    ).toEqual([{ state: "firing", from: 60, to: 0 }]);
  });

  it("ignores a prior state the instance had already left", () => {
    expect(
      segments([], undefined, [
        { fingerprint: "a", eventType: "instance_resolved", at: at(600) },
      ]),
    ).toEqual([]);
  });

  it("lets an event inside the window close a state carried into it", () => {
    expect(
      segments(
        [{ fingerprint: "a", eventType: "instance_resolved", at: at(20) }],
        undefined,
        [{ fingerprint: "a", eventType: "instance_fired", at: at(600) }],
      ),
    ).toEqual([{ state: "firing", from: 60, to: 20 }]);
  });

  it("paints the worst state where two instances overlap", () => {
    // `b` is pending underneath `a`'s firing stretch; the firing one wins for
    // the overlap and the pending tail shows on its own afterwards.
    expect(
      segments([
        { fingerprint: "b", eventType: "instance_pending", at: at(30) },
        { fingerprint: "a", eventType: "instance_fired", at: at(25) },
        { fingerprint: "a", eventType: "instance_resolved", at: at(15) },
        { fingerprint: "b", eventType: "instance_closed", at: at(5) },
      ]),
    ).toEqual([
      { state: "pending", from: 30, to: 25 },
      { state: "firing", from: 25, to: 15 },
      { state: "pending", from: 15, to: 5 },
    ]);
  });

  it("merges a run of failed evaluations into one degraded stretch", () => {
    expect(
      segments([
        { fingerprint: "", eventType: "evaluation_failed", at: at(20) },
        { fingerprint: "", eventType: "evaluation_failed", at: at(19) },
        { fingerprint: "", eventType: "evaluation_failed", at: at(18) },
      ]),
    ).toEqual([{ state: "degraded", from: 20, to: 17 }]);
  });

  it("outranks firing with degraded over the same minutes", () => {
    // A rule that cannot evaluate is hiding an unknown number of firing
    // instances, so the chart must not report the stale firing state as fact.
    const out = segments([
      { fingerprint: "a", eventType: "instance_fired", at: at(30) },
      { fingerprint: "", eventType: "evaluation_failed", at: at(20) },
    ]);
    expect(out).toEqual([
      { state: "firing", from: 30, to: 20 },
      { state: "degraded", from: 20, to: 19 },
      { state: "firing", from: 19, to: 0 },
    ]);
  });

  it("splits a firing stretch at the moment a silence takes hold", () => {
    expect(
      segments(
        [{ fingerprint: "a", eventType: "instance_fired", at: at(30) }],
        at(10),
      ),
    ).toEqual([
      { state: "firing", from: 30, to: 10 },
      { state: "silenced", from: 10, to: 0 },
    ]);
  });

  it("leaves pending alone under a silence: pending never delivers", () => {
    expect(
      segments(
        [{ fingerprint: "a", eventType: "instance_pending", at: at(30) }],
        at(10),
      ),
    ).toEqual([{ state: "pending", from: 30, to: 0 }]);
  });

  it("returns nothing for a rule with no events", () => {
    expect(segments([])).toEqual([]);
  });
});
