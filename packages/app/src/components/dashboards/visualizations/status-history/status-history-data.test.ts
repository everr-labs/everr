import { describe, expect, it } from "vite-plus/test";
import { statusHistorySpec } from "./spec";
import { buildStatusHistoryModel } from "./status-history-data";

const DOMAIN: [number, number] = [0, 100_000];

function specWith(overrides: Record<string, unknown> = {}) {
  return statusHistorySpec.parse(overrides);
}

// Timestamps below 1e12 are treated as epoch seconds by toTimestamp, so test
// rows use second-precision epochs (domain ms = ts × 1000).
const ts = (seconds: number) => seconds;

// Reading lanes, states and colors from the rows is shared with the state
// timeline and tested there.
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
    expect(model.lanes[1]!.cells.map((c) => c.state)).toEqual(["up", "up", "up"]);
  });

  it("centers a cell on each sample, sized to the sampling interval times colWidth", () => {
    const model = buildStatusHistoryModel(
      [
        [
          { ts: ts(20), api: "up" },
          { ts: ts(30), api: "up" },
          { ts: ts(70), api: "down" },
        ],
      ],
      specWith({ colWidth: 0.5 }),
      DOMAIN,
    );
    // interval = 10s (the smallest gap); cell width = 10s × 0.5 = 5s. A
    // missing sample is an empty slot: 30s does not stretch to 70s.
    expect(model.lanes[0]!.cells).toEqual([
      { ts: 20_000, start: 17_500, end: 22_500, state: "up" },
      { ts: 30_000, start: 27_500, end: 32_500, state: "up" },
      { ts: 70_000, start: 67_500, end: 72_500, state: "down" },
    ]);
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

  it("shares one slot width across lanes with offset samples, a null being no cell", () => {
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
    expect(model.lanes.map((lane) => lane.cells.map((c) => [c.start, c.end]))).toEqual([
      [
        [5_000, 15_000],
        [35_000, 45_000],
      ],
      [[15_000, 25_000]],
    ]);
  });
});
