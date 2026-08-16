import { truncateWithEllipsis } from "@/lib/truncate";
import type {
  AlertingEvaluationSample,
  AlertingRuleCondition,
  AlertingRuleEvaluationSeries,
} from "../types";
import { alertingConditionMatches } from "./condition";

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
  return truncateWithEllipsis(summary, 500);
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

// `rowCount` is the count of rows the unfiltered alert query returned, not
// the count that matched the condition (a GROUP BY rule's row_count can be
// entirely healthy rows), so it cannot stand in for the breach signal. The
// condition has to be re-applied to the stored samples, the same way the
// chart's own outcome computation already does (chart-data.ts).
function evaluationState(
  row: StoredAlertEvaluationPoint,
  condition: AlertingRuleCondition,
): EvaluationState {
  if (row.error !== null) return "failed";
  const breaching = row.samples.some(
    (sample) =>
      sample.value !== null &&
      alertingConditionMatches({ value: sample.value }, condition),
  );
  return breaching ? "breaching" : "ok";
}

// Indexes a downsampled chart must never drop: both range edges, every
// failed or breaching evaluation, and every point where the state changes
// (entering or recovering from an incident), even when the new state is
// itself "ok".
function requiredEvaluationIndexes(
  rows: readonly StoredAlertEvaluationPoint[],
  condition: AlertingRuleCondition,
): Set<number> {
  const required = new Set<number>([0, rows.length - 1]);
  let previousState = evaluationState(rows[0], condition);
  for (let index = 1; index < rows.length; index++) {
    const state = evaluationState(rows[index], condition);
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
  condition: AlertingRuleCondition,
): AlertingRuleEvaluationSeries {
  const count = Math.max(2, targetPoints);
  let selected: readonly StoredAlertEvaluationPoint[] = rows;
  if (rows.length > count) {
    let indexes = requiredEvaluationIndexes(rows, condition);
    if (indexes.size > count) {
      // A whole-window incident (or constant flapping) makes every point
      // required, which would ship the full row set to the browser. Grid the
      // required set itself down to the budget: the incident's edges and
      // extent survive, interior points beyond display resolution do not.
      const ordered = Array.from(indexes).sort((a, b) => a - b);
      indexes = new Set<number>();
      for (let i = 0; i < count; i++) {
        indexes.add(
          ordered[Math.round((i * (ordered.length - 1)) / (count - 1))],
        );
      }
    } else {
      // Fill from the full-budget grid, thinned evenly when required points
      // already claimed part of the budget. A grid walked until the budget
      // runs out puts every filler point left of where it stops, and the
      // newest part of the window, the part a reader cares about most,
      // renders required points only.
      const grid: number[] = [];
      for (let i = 0; i < count; i++) {
        const index = Math.round((i * (rows.length - 1)) / (count - 1));
        if (!indexes.has(index)) grid.push(index);
      }
      const keep = Math.min(grid.length, count - indexes.size);
      for (let i = 0; i < keep; i++) {
        indexes.add(
          grid[Math.round((i * (grid.length - 1)) / Math.max(1, keep - 1))],
        );
      }
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
