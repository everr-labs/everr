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

/**
 * Evenly reduce stored evaluations while preserving both range edges. The
 * regular cadence makes index sampling equivalent to a time grid without
 * hiding the newest point behind bucket alignment.
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
    points: selected.map(evaluationPoint),
    recent_points: rows.slice(-25).map(evaluationPoint),
    evaluation_count: rows.length,
    samples_truncated: rows.some((row) => row.samplesTruncated),
  };
}
