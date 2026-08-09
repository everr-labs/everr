import type {
  AlertingEvaluationSample,
  AlertingRuleEvaluationSeries,
} from "../types";

export type StoredAlertEvaluationPoint = {
  scheduledFor: Date;
  error: string | null;
  rowCount: number | null;
  samples: AlertingEvaluationSample[];
  samplesTruncated: boolean;
};

export function parseAlertEvaluationSamples(
  json: string,
): AlertingEvaluationSample[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((sample): AlertingEvaluationSample[] => {
    if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
      return [];
    }
    const record = sample as Record<string, unknown>;
    if (
      typeof record.fingerprint !== "string" ||
      !record.labels ||
      typeof record.labels !== "object" ||
      Array.isArray(record.labels) ||
      (record.value !== null && typeof record.value !== "number")
    ) {
      return [];
    }
    const labels = Object.fromEntries(
      Object.entries(record.labels).flatMap(([key, label]) =>
        typeof label === "string" ? [[key, label]] : [],
      ),
    );
    return [{ fingerprint: record.fingerprint, labels, value: record.value }];
  });
}

function evaluationErrorSummary(error: string | null): string | null {
  if (error === null) return null;
  const summary = error.replace(/\s+/g, " ").trim();
  return summary.length > 500 ? `${summary.slice(0, 497)}...` : summary;
}

function evaluationPoint(
  row: StoredAlertEvaluationPoint,
): AlertingRuleEvaluationSeries["points"][number] {
  return {
    t: row.scheduledFor.toISOString(),
    samples: row.samples,
    failed: row.error !== null,
    error: evaluationErrorSummary(row.error),
    row_count: row.rowCount,
  };
}

type EvaluationState = "ok" | "breaching" | "failed";

// `rowCount` is the count of rows the alert query matched at that
// evaluation, so a positive count is the breach signal itself; a failed
// evaluation carries no row count (see repository.ts), so error takes
// priority.
function evaluationState(row: StoredAlertEvaluationPoint): EvaluationState {
  if (row.error !== null) return "failed";
  if (row.rowCount !== null && row.rowCount > 0) return "breaching";
  return "ok";
}

// Indexes a downsampled chart must never drop: both range edges, every
// failed or breaching evaluation, and every point where the state changes
// (entering or recovering from an incident), even when the new state is
// itself "ok".
function requiredEvaluationIndexes(
  rows: readonly StoredAlertEvaluationPoint[],
): Set<number> {
  const required = new Set<number>([0, rows.length - 1]);
  let previousState = evaluationState(rows[0]);
  for (let index = 1; index < rows.length; index++) {
    const state = evaluationState(rows[index]);
    if (state !== "ok") required.add(index);
    if (state !== previousState) required.add(index);
    previousState = state;
  }
  return required;
}

/**
 * Reduce stored evaluations to a display budget without hiding the point
 * that matters. Exceptional evaluations and state transitions are kept
 * unconditionally; an even index grid then fills whatever budget remains,
 * so the regular cadence still reads as a time grid when nothing is wrong.
 */
export function shapeAlertEvaluationSeries(
  rows: readonly StoredAlertEvaluationPoint[],
  targetPoints: number,
): AlertingRuleEvaluationSeries {
  const count = Math.max(2, targetPoints);
  let selected: readonly StoredAlertEvaluationPoint[] = rows;
  if (rows.length > count) {
    const indexes = requiredEvaluationIndexes(rows);
    const target = Math.max(indexes.size, count);
    for (let i = 0; i < count && indexes.size < target; i++) {
      indexes.add(Math.round((i * (rows.length - 1)) / (count - 1)));
    }
    selected = Array.from(indexes)
      .sort((a, b) => a - b)
      .map((index) => rows[index]);
  }
  return {
    points: selected.map(evaluationPoint),
    recent_points: rows.slice(-25).map(evaluationPoint),
    evaluation_count: rows.length,
    samples_truncated: rows.some((row) => row.samplesTruncated),
  };
}
