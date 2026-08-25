import { describe, expect, it } from "vitest";
import type { AlertingRuleCondition } from "../types";
import {
  parseAlertEvaluationSamples,
  type StoredAlertEvaluationPoint,
  shapeAlertEvaluationSeries,
} from "./evaluation-series";

const CONDITION: AlertingRuleCondition = { operator: "gt", threshold: 100 };
// Comfortably above every default sample value used below (minute indexes,
// at most a few hundred), so only rows that opt in via `breach` cross it.
const BREACH_VALUE = 100_000;

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

// A GROUP BY-shaped point: several label sets in one evaluation, only one of
// which crosses the condition.
const breach = (
  point: StoredAlertEvaluationPoint,
): StoredAlertEvaluationPoint => ({
  ...point,
  rowCount: 3,
  samples: [
    { fingerprint: "eu", labels: { region: "eu" }, value: 1 },
    { fingerprint: "us", labels: { region: "us" }, value: BREACH_VALUE },
  ],
});

describe("shapeAlertEvaluationSeries", () => {
  it("preserves the first and newest point while downsampling", () => {
    const result = shapeAlertEvaluationSeries(
      Array.from({ length: 10 }, (_, i) => row(i)),
      4,
      CONDITION,
    );

    expect(result.points.map((point) => point.t)).toEqual([
      "2026-08-06T12:00:00.000Z",
      "2026-08-06T12:03:00.000Z",
      "2026-08-06T12:06:00.000Z",
      "2026-08-06T12:09:00.000Z",
    ]);
  });

  it("keeps a breaching evaluation sitting between sampled indexes, from a matching sample in the group", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i));
    rows[5] = breach(rows[5]);

    const result = shapeAlertEvaluationSeries(rows, 4, CONDITION);

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

  // The regression: row_count is the unfiltered query's row count, not the
  // count that matched the condition, so a GROUP BY rule with a lot of
  // healthy rows and none breaching must not read as breaching.
  it("ignores a high unfiltered row_count when no sample in the group matches", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i));
    rows[5] = {
      ...rows[5],
      rowCount: 50,
      samples: [
        { fingerprint: "eu", labels: { region: "eu" }, value: 1 },
        { fingerprint: "us", labels: { region: "us" }, value: 2 },
      ],
    };

    const result = shapeAlertEvaluationSeries(rows, 4, CONDITION);

    expect(result.points.map((point) => point.t)).toEqual([
      "2026-08-06T12:00:00.000Z",
      "2026-08-06T12:03:00.000Z",
      "2026-08-06T12:06:00.000Z",
      "2026-08-06T12:09:00.000Z",
    ]);
  });

  // A required cluster at the window start must not consume the filler grid:
  // walked to a budget cutoff, every filler point lands left of the cutoff
  // and the newest part of the window renders required points only.
  it("spreads the leftover budget across the whole window", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      i >= 1 && i <= 4 ? breach(row(i)) : row(i),
    );

    const result = shapeAlertEvaluationSeries(rows, 10, CONDITION);

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
    const rows = Array.from({ length: 1000 }, (_, i) => breach(row(i)));

    const result = shapeAlertEvaluationSeries(rows, 300, CONDITION);

    expect(result.points.length).toBeLessThanOrEqual(300);
    expect(result.points[0].t).toBe(rows[0].scheduledFor.toISOString());
    expect(result.points.at(-1)?.t).toBe(rows[999].scheduledFor.toISOString());
    expect(result.evaluation_count).toBe(1000);
  });

  it("reports truncation even when the truncated evaluation is downsampled out", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i, i === 1));
    expect(
      shapeAlertEvaluationSeries(rows, 2, CONDITION).samples_truncated,
    ).toBe(true);
  });

  it("keeps exact recent checks and summarizes display errors", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i));
    rows[29] = {
      ...rows[29],
      error: "query\nfailed   after timeout",
      rowCount: null,
      samples: [],
    };

    const result = shapeAlertEvaluationSeries(rows, 4, CONDITION);

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
