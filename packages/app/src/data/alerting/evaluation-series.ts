import type {
  AlertingEvaluationSample,
  AlertingRuleEvaluationSeries,
} from "./types";

export type StoredAlertEvaluationPoint = {
  scheduledFor: Date;
  error: string | null;
  samples: AlertingEvaluationSample[];
  samplesTruncated: boolean;
};

/**
 * Evenly reduce stored evaluations while preserving both range edges. The
 * engine evaluates on a regular cadence, so index sampling is equivalent to a
 * time grid without hiding the newest point behind bucket alignment.
 */
export function shapeAlertEvaluationSeries(
  rows: readonly StoredAlertEvaluationPoint[],
  targetPoints: number,
): AlertingRuleEvaluationSeries {
  const count = Math.max(2, targetPoints);
  let selected: readonly StoredAlertEvaluationPoint[] = rows;
  if (rows.length > count) {
    const indexes = Array.from({ length: count }, (_, i) =>
      Math.round((i * (rows.length - 1)) / (count - 1)),
    );
    selected = indexes.map((index) => rows[index]);
  }
  return {
    points: selected.map((row) => ({
      t: row.scheduledFor.toISOString(),
      samples: row.samples,
      failed: row.error !== null,
    })),
    samples_truncated: rows.some((row) => row.samplesTruncated),
  };
}
