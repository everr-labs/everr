import { describe, expect, it } from "vitest";
import {
  parseAlertEvaluationSamples,
  type StoredAlertEvaluationPoint,
  shapeAlertEvaluationSeries,
} from "./evaluation-series";

const row = (
  minute: number,
  samplesTruncated = false,
): StoredAlertEvaluationPoint => ({
  scheduledFor: new Date(Date.UTC(2026, 7, 6, 12, minute)),
  error: null,
  rowCount: 0,
  samples: [{ fingerprint: "api", labels: { service: "api" }, value: minute }],
  samplesTruncated,
});

describe("shapeAlertEvaluationSeries", () => {
  it("preserves the first and newest point while downsampling", () => {
    const result = shapeAlertEvaluationSeries(
      Array.from({ length: 10 }, (_, i) => row(i)),
      4,
    );

    expect(result.points.map((point) => point.t)).toEqual([
      "2026-08-06T12:00:00.000Z",
      "2026-08-06T12:03:00.000Z",
      "2026-08-06T12:06:00.000Z",
      "2026-08-06T12:09:00.000Z",
    ]);
  });

  it("keeps a breaching evaluation sitting between sampled indexes", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i));
    rows[5] = { ...rows[5], rowCount: 3 };

    const result = shapeAlertEvaluationSeries(rows, 4);

    // The even grid alone would pick 0, 3, 6, 9 and drop the breach at
    // minute 5; the recovery point at minute 6 is kept too since the state
    // transition back to ok is itself worth showing.
    expect(result.points.map((point) => point.t)).toEqual([
      "2026-08-06T12:00:00.000Z",
      "2026-08-06T12:05:00.000Z",
      "2026-08-06T12:06:00.000Z",
      "2026-08-06T12:09:00.000Z",
    ]);
  });

  // A required cluster at the window start must not consume the filler grid:
  // walked to a budget cutoff, every filler point lands left of the cutoff
  // and the newest part of the window renders required points only.
  it("spreads the leftover budget across the whole window", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      i >= 1 && i <= 4 ? { ...row(i), rowCount: 3 } : row(i),
    );

    const result = shapeAlertEvaluationSeries(rows, 10);

    const times = result.points.map((point) => Date.parse(point.t));
    const midWindow = times.filter(
      (t) =>
        t > rows[40].scheduledFor.getTime() &&
        t < rows[98].scheduledFor.getTime(),
    );
    expect(midWindow.length).toBeGreaterThan(0);
  });

  // A rule breaching for the whole window makes every point required; without
  // a cap the chart response carries the full row set, samples included.
  it("bounds a whole-window incident to the display budget, edges intact", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      ...row(i),
      rowCount: 3,
    }));

    const result = shapeAlertEvaluationSeries(rows, 300);

    expect(result.points.length).toBeLessThanOrEqual(300);
    expect(result.points[0].t).toBe(rows[0].scheduledFor.toISOString());
    expect(result.points.at(-1)?.t).toBe(rows[999].scheduledFor.toISOString());
    expect(result.evaluation_count).toBe(1000);
  });

  it("reports truncation even when the truncated evaluation is downsampled out", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i, i === 1));
    expect(shapeAlertEvaluationSeries(rows, 2).samples_truncated).toBe(true);
  });

  it("keeps exact recent checks and summarizes display errors", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i));
    rows[29] = {
      ...rows[29],
      error: "query\nfailed   after timeout",
      rowCount: null,
      samples: [],
    };

    const result = shapeAlertEvaluationSeries(rows, 4);

    expect(result.evaluation_count).toBe(30);
    expect(result.recent_points).toHaveLength(25);
    expect(result.recent_points.at(-1)).toMatchObject({
      failed: true,
      error: "query failed after timeout",
      row_count: null,
    });
  });
});

describe("parseAlertEvaluationSamples", () => {
  it("keeps valid samples and rejects malformed payloads", () => {
    expect(
      parseAlertEvaluationSamples(
        '[{"fingerprint":"api","labels":{"service":"api"},"value":42}]',
      ),
    ).toEqual([{ fingerprint: "api", labels: { service: "api" }, value: 42 }]);
    expect(parseAlertEvaluationSamples("not-json")).toEqual([]);
    expect(parseAlertEvaluationSamples('[{"fingerprint":1}]')).toEqual([]);
  });
});
