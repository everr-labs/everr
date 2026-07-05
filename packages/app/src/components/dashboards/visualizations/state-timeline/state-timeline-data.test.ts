import { describe, expect, it } from "vite-plus/test";
import { SERIES_COLORS } from "../data-utils";
import { stateTimelineSpec } from "./spec";
import { buildStateTimelineModel } from "./state-timeline-data";

const DOMAIN: [number, number] = [0, 100_000];

function specWith(overrides: Record<string, unknown> = {}) {
  return stateTimelineSpec.parse(overrides);
}

// Timestamps below 1e12 are treated as epoch seconds by toTimestamp, so test
// rows use second-precision epochs (domain ms = ts × 1000).
const ts = (seconds: number) => seconds;

describe("buildStateTimelineModel", () => {
  it("builds one lane per non-time column (wide format)", () => {
    const model = buildStateTimelineModel(
      [
        [
          { ts: ts(10), api: "up", db: "up" },
          { ts: ts(50), api: "down", db: "up" },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.lanes.map((l) => l.label)).toEqual(["api", "db"]);
    expect(model.lanes[0]!.segments).toEqual([
      { start: 10_000, end: 50_000, state: "up" },
      { start: 50_000, end: 100_000, state: "down" },
    ]);
    // db never changes state — one merged segment to the domain end
    expect(model.lanes[1]!.segments).toEqual([{ start: 10_000, end: 100_000, state: "up" }]);
  });

  it("keeps consecutive equal states separate when mergeConsecutive is off", () => {
    const model = buildStateTimelineModel(
      [
        [
          { ts: ts(10), api: "up" },
          { ts: ts(50), api: "up" },
        ],
      ],
      specWith({ mergeConsecutive: false }),
      DOMAIN,
    );
    expect(model.lanes[0]!.segments).toEqual([
      { start: 10_000, end: 50_000, state: "up" },
      { start: 50_000, end: 100_000, state: "up" },
    ]);
  });

  it("renders a null state as a gap, not a segment", () => {
    const model = buildStateTimelineModel(
      [
        [
          { ts: ts(10), api: "up" },
          { ts: ts(40), api: null },
          { ts: ts(70), api: "up" },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.lanes[0]!.segments).toEqual([
      { start: 10_000, end: 40_000, state: "up" },
      { start: 70_000, end: 100_000, state: "up" },
    ]);
  });

  it("clamps segments to the domain and keeps a state that started before it", () => {
    const model = buildStateTimelineModel(
      [
        [
          { ts: ts(10), api: "up" },
          { ts: ts(60), api: "down" },
        ],
      ],
      specWith(),
      [30_000, 80_000],
    );
    expect(model.lanes[0]!.segments).toEqual([
      { start: 30_000, end: 60_000, state: "up" },
      { start: 60_000, end: 80_000, state: "down" },
    ]);
  });

  it("drops samples entirely outside the domain", () => {
    const model = buildStateTimelineModel([[{ ts: ts(200), api: "up" }]], specWith(), DOMAIN);
    expect(model.lanes[0]!.segments).toEqual([]);
    expect(model.states).toEqual([]);
  });

  it("pivots long-format rows into one lane per seriesColumn value", () => {
    const model = buildStateTimelineModel(
      [
        [
          { ts: ts(10), service: "api", state: "ok" },
          { ts: ts(10), service: "db", state: "warn" },
          { ts: ts(50), service: "api", state: "error" },
        ],
      ],
      specWith({ seriesColumn: "service" }),
      DOMAIN,
    );
    expect(model.lanes.map((l) => l.label)).toEqual(["api", "db"]);
    expect(model.lanes[0]!.segments).toEqual([
      { start: 10_000, end: 50_000, state: "ok" },
      { start: 50_000, end: 100_000, state: "error" },
    ]);
    expect(model.lanes[1]!.segments).toEqual([{ start: 10_000, end: 100_000, state: "warn" }]);
  });

  it("reads the long-format state from an explicit stateColumn", () => {
    const model = buildStateTimelineModel(
      [
        [
          { ts: ts(10), service: "api", ignored: "x", status: "ok" },
          { ts: ts(50), service: "api", ignored: "y", status: "down" },
        ],
      ],
      specWith({ seriesColumn: "service", stateColumn: "status" }),
      DOMAIN,
    );
    expect(model.lanes[0]!.segments.map((s) => s.state)).toEqual(["ok", "down"]);
  });

  it("stringifies numeric and boolean states", () => {
    const model = buildStateTimelineModel(
      [
        [
          { ts: ts(10), code: 0, healthy: true },
          { ts: ts(50), code: 2, healthy: false },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.states).toEqual(["0", "2", "true", "false"]);
  });

  it("accumulates lanes across multiple query frames", () => {
    const model = buildStateTimelineModel(
      [[{ ts: ts(10), api: "up" }], [{ ts: ts(10), worker: "idle" }]],
      specWith(),
      DOMAIN,
    );
    expect(model.lanes.map((l) => l.label)).toEqual(["api", "worker"]);
  });

  it("skips frames without a time column", () => {
    const model = buildStateTimelineModel([[{ name: "api", state: "up" }]], specWith(), DOMAIN);
    expect(model.lanes).toEqual([]);
  });

  it("colors states from spec.colors without consuming palette slots", () => {
    const model = buildStateTimelineModel(
      [
        [
          { ts: ts(10), api: "up" },
          { ts: ts(40), api: "down" },
          { ts: ts(70), api: "degraded" },
        ],
      ],
      specWith({ colors: { down: "#ef4444" } }),
      DOMAIN,
    );
    expect(model.colorByState).toEqual({
      up: SERIES_COLORS[0],
      down: "#ef4444",
      degraded: SERIES_COLORS[1],
    });
  });
});
