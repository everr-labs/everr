import { describe, expect, it } from "vitest";
import {
  type StoredAlertEvaluationPoint,
  shapeAlertEvaluationSeries,
} from "./evaluation-series";

const row = (
  minute: number,
  samplesTruncated = false,
): StoredAlertEvaluationPoint => ({
  scheduledFor: new Date(Date.UTC(2026, 7, 6, 12, minute)),
  error: null,
  rowCount: 1,
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
