import { describe, expect, it } from "vitest";
import { SERIES_COLORS } from "../data-utils";
import { statusHistorySpec } from "./spec";
import { buildStatusHistoryModel } from "./status-history-data";

const DOMAIN: [number, number] = [0, 100_000];

function specWith(overrides: Record<string, unknown> = {}) {
  return statusHistorySpec.parse(overrides);
}

// Timestamps below 1e12 are treated as epoch seconds by toTimestamp, so test
// rows use second-precision epochs (domain ms = ts × 1000).
const ts = (seconds: number) => seconds;

describe("buildStatusHistoryModel", () => {
  it("builds one lane per non-time column with one cell per sample (wide format)", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), api: "up", db: "up" },
          { ts: ts(20), api: "down", db: "up" },
          { ts: ts(30), api: "up", db: "up" },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.lanes.map((l) => l.label)).toEqual(["api", "db"]);
    // db is "up" throughout but still gets one cell per sample — no merging
    expect(model.lanes[1]!.cells.map((c) => c.state)).toEqual([
      "up",
      "up",
      "up",
    ]);
  });

  it("centers cells on their timestamp, sized to the sampling interval times colWidth", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(20), api: "up" },
          { ts: ts(30), api: "up" },
        ],
      ],
      specWith({ colWidth: 0.5 }),
      DOMAIN,
    );
    // interval = 10s; cell width = 10s × 0.5 = 5s, centered on the sample
    expect(model.lanes[0]!.cells).toEqual([
      { ts: 20_000, start: 17_500, end: 22_500, state: "up" },
      { ts: 30_000, start: 27_500, end: 32_500, state: "up" },
    ]);
  });

  it("does not extend a sample to the next one — a missing sample is an empty slot", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), api: "up" },
          { ts: ts(50), api: "up" },
          { ts: ts(60), api: "up" },
        ],
      ],
      specWith({ colWidth: 1 }),
      DOMAIN,
    );
    // interval = min gap = 10s; the 10s→50s stretch stays empty
    const cells = model.lanes[0]!.cells;
    expect(cells[0]!.end).toBe(15_000);
    expect(cells[1]!.start).toBe(45_000);
  });

  it("renders a null status as no cell", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), api: "up" },
          { ts: ts(20), api: null },
          { ts: ts(30), api: "up" },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.lanes[0]!.cells.map((c) => c.ts)).toEqual([10_000, 30_000]);
  });

  it("drops cells entirely outside the domain and clamps overlapping edges to it", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), api: "up" },
          { ts: ts(60), api: "down" },
          { ts: ts(200), api: "up" },
        ],
      ],
      specWith({ colWidth: 1 }),
      [55_000, 100_000],
    );
    // 10s and 200s fall outside [55s, 100s]; interval = 50s (10s→60s),
    // so the 60s cell would span 35s→85s but clamps to the domain start
    expect(model.lanes[0]!.cells).toEqual([
      { ts: 60_000, start: 55_000, end: 85_000, state: "down" },
    ]);
  });

  it("falls back to a fraction of the domain when only one distinct timestamp exists", () => {
    const model = buildStatusHistoryModel(
      [[{ ts: ts(50), api: "up" }]],
      specWith({ colWidth: 1 }),
      DOMAIN,
    );
    // fallback slot = span / 20 = 5s, centered on the sample
    expect(model.lanes[0]!.cells).toEqual([
      { ts: 50_000, start: 47_500, end: 52_500, state: "up" },
    ]);
  });

  it("shares one slot width across lanes with offset samples", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), api: "up", db: null },
          { ts: ts(20), api: null, db: "up" },
          { ts: ts(40), api: "up", db: null },
        ],
      ],
      specWith({ colWidth: 1 }),
      DOMAIN,
    );
    // interval = 10s (global), even though each lane's own samples are 30s
    // and 20s apart — cells stay aligned to the shared sampling grid
    expect(model.lanes[0]!.cells[0]).toMatchObject({
      start: 5_000,
      end: 15_000,
    });
    expect(model.lanes[1]!.cells[0]).toMatchObject({
      start: 15_000,
      end: 25_000,
    });
  });

  it("pivots long-format rows into one lane per seriesColumn value", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), service: "api", state: "ok" },
          { ts: ts(10), service: "db", state: "warn" },
          { ts: ts(20), service: "api", state: "error" },
        ],
      ],
      specWith({ seriesColumn: "service" }),
      DOMAIN,
    );
    expect(model.lanes.map((l) => l.label)).toEqual(["api", "db"]);
    expect(model.lanes[0]!.cells.map((c) => c.state)).toEqual(["ok", "error"]);
    expect(model.lanes[1]!.cells.map((c) => c.state)).toEqual(["warn"]);
  });

  it("reads the long-format status from an explicit stateColumn", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), service: "api", ignored: "x", status: "ok" },
          { ts: ts(20), service: "api", ignored: "y", status: "down" },
        ],
      ],
      specWith({ seriesColumn: "service", stateColumn: "status" }),
      DOMAIN,
    );
    expect(model.lanes[0]!.cells.map((c) => c.state)).toEqual(["ok", "down"]);
  });

  it("stringifies numeric and boolean statuses", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), code: 0, healthy: true },
          { ts: ts(20), code: 2, healthy: false },
        ],
      ],
      specWith(),
      DOMAIN,
    );
    expect(model.states).toEqual(["0", "2", "true", "false"]);
  });

  it("accumulates lanes across multiple query frames", () => {
    const model = buildStatusHistoryModel(
      [[{ ts: ts(10), api: "up" }], [{ ts: ts(10), worker: "idle" }]],
      specWith(),
      DOMAIN,
    );
    expect(model.lanes.map((l) => l.label)).toEqual(["api", "worker"]);
  });

  it("skips frames without a time column", () => {
    const model = buildStatusHistoryModel(
      [[{ name: "api", state: "up" }]],
      specWith(),
      DOMAIN,
    );
    expect(model.lanes).toEqual([]);
  });

  it("colors statuses from spec.colors without consuming palette slots", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(10), api: "up" },
          { ts: ts(20), api: "down" },
          { ts: ts(30), api: "degraded" },
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
