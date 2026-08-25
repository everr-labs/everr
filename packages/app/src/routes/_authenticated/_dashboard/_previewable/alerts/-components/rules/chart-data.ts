import { SERIES_COLORS } from "@/components/dashboards/visualizations/data-utils";
import type { AlertEventLogRow } from "@/data/alerting/history/repository.server";
import { alertingConditionMatches } from "@/data/alerting/rules/condition";
import type {
  AlertingRuleCondition,
  AlertingRuleEvaluationPoint,
} from "@/data/alerting/types";

export const ALERT_RULE_CHART_SERIES_LIMIT = 12;
const ALERT_RULE_RAIL_MAX_BUCKETS = 60;

const ALERT_RULE_CHART_MIN_POINTS = 50;
const ALERT_RULE_CHART_MAX_POINTS = 500;
const ALERT_RULE_CHART_HORIZONTAL_CHROME_PX = 64;
const ALERT_RULE_CHART_PX_PER_POINT = 2;
const ALERT_RULE_CHART_POINT_QUANTUM = 25;

export function alertRuleChartPointTarget(containerWidth: number): number {
  const plotWidth = Math.max(
    0,
    containerWidth - ALERT_RULE_CHART_HORIZONTAL_CHROME_PX,
  );
  const rawTarget = Math.ceil(plotWidth / ALERT_RULE_CHART_PX_PER_POINT);
  const quantizedTarget =
    Math.ceil(rawTarget / ALERT_RULE_CHART_POINT_QUANTUM) *
    ALERT_RULE_CHART_POINT_QUANTUM;
  return Math.min(
    ALERT_RULE_CHART_MAX_POINTS,
    Math.max(ALERT_RULE_CHART_MIN_POINTS, quantizedTarget),
  );
}

type AlertRuleChartSeries = {
  key: string;
  fingerprint: string;
  label: string;
  color: string;
};

type AlertRuleChartRow = {
  t: number;
  failed: boolean;
  [key: string]: number | boolean | null;
};

export type AlertRuleEvaluationOutcome =
  | "healthy"
  | "breached"
  | "no_data"
  | "failed"
  | "unknown";

type AlertRuleEvaluationSpan = {
  start: number;
  end: number;
  outcome: "no_data" | "failed";
};

type AlertRuleEvaluationBucket = {
  start: number;
  end: number;
  outcome: AlertRuleEvaluationOutcome | null;
  evaluations: number;
};

type AlertRuleIncidentBucket = {
  start: number;
  end: number;
  activeInstances: number;
};

/** One instance's firing stretch, clamped to the rendered domain. */
type AlertRuleFiringPeriod = {
  start: number;
  end: number;
  fingerprint: string;
};

type AlertRuleLatestCheckSummary = {
  total: number;
  breached: number;
  healthy: number;
  noData: number;
};

const EVALUATION_OUTCOME_PRIORITY: Record<AlertRuleEvaluationOutcome, number> =
  {
    healthy: 0,
    breached: 1,
    no_data: 2,
    failed: 3,
    unknown: -1,
  };

export function alertRuleEvaluationOutcome(
  point: AlertingRuleEvaluationPoint,
  condition: AlertingRuleCondition,
): AlertRuleEvaluationOutcome {
  if (point.failed) return "failed";
  const values = point.samples.flatMap((sample) =>
    sample.value === null ? [] : [sample.value],
  );
  if (values.length === 0) {
    return point.row_count === null ? "unknown" : "no_data";
  }
  return values.some((value) => alertingConditionMatches({ value }, condition))
    ? "breached"
    : "healthy";
}

export function summarizeAlertRuleLatestCheck(
  point: AlertingRuleEvaluationPoint,
  condition: AlertingRuleCondition,
): AlertRuleLatestCheckSummary {
  const summary: AlertRuleLatestCheckSummary = {
    total: point.samples.length,
    breached: 0,
    healthy: 0,
    noData: 0,
  };
  for (const sample of point.samples) {
    if (sample.value === null) summary.noData += 1;
    else if (alertingConditionMatches({ value: sample.value }, condition)) {
      summary.breached += 1;
    } else summary.healthy += 1;
  }
  return summary;
}

export function buildAlertRuleEvaluationSpans(
  points: readonly AlertingRuleEvaluationPoint[],
  condition: AlertingRuleCondition,
  domain: [number, number],
  intervalMs: number,
): AlertRuleEvaluationSpan[] {
  const halfInterval = Math.max(1, intervalMs / 2);
  const candidates = points.flatMap((point) => {
    const outcome = alertRuleEvaluationOutcome(point, condition);
    if (outcome !== "no_data" && outcome !== "failed") return [];
    const timestamp = Date.parse(point.t);
    if (!Number.isFinite(timestamp)) return [];
    const start = Math.max(domain[0], timestamp - halfInterval);
    const end = Math.min(domain[1], timestamp + halfInterval);
    return start < end ? [{ start, end, outcome }] : [];
  });
  const spans: AlertRuleEvaluationSpan[] = [];
  for (const candidate of candidates.sort((a, b) => a.start - b.start)) {
    const previous = spans.at(-1);
    if (
      previous &&
      previous.outcome === candidate.outcome &&
      candidate.start <= previous.end + intervalMs * 0.25
    ) {
      previous.end = Math.max(previous.end, candidate.end);
    } else {
      spans.push({ ...candidate });
    }
  }
  return spans;
}

function bucketBounds(
  domain: [number, number],
  index: number,
  count: number,
): [number, number] {
  const width = (domain[1] - domain[0]) / count;
  return [domain[0] + width * index, domain[0] + width * (index + 1)];
}

export function alertRuleRailBucketCount(
  domain: [number, number],
  intervalMs: number,
): number {
  const spanMs = Math.max(0, domain[1] - domain[0]);
  const minimumBucketMs =
    Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 1;
  return Math.max(
    1,
    Math.min(ALERT_RULE_RAIL_MAX_BUCKETS, Math.floor(spanMs / minimumBucketMs)),
  );
}

export function buildAlertRuleEvaluationRail(
  points: readonly AlertingRuleEvaluationPoint[],
  condition: AlertingRuleCondition,
  domain: [number, number],
  bucketCount = 60,
): AlertRuleEvaluationBucket[] {
  const count = Math.max(1, bucketCount);
  const buckets: AlertRuleEvaluationBucket[] = Array.from(
    { length: count },
    (_, index) => {
      const [start, end] = bucketBounds(domain, index, count);
      return { start, end, outcome: null, evaluations: 0 };
    },
  );
  const span = Math.max(1, domain[1] - domain[0]);
  for (const point of points) {
    const timestamp = Date.parse(point.t);
    if (timestamp < domain[0] || timestamp > domain[1]) continue;
    const index = Math.min(
      count - 1,
      Math.max(0, Math.floor(((timestamp - domain[0]) / span) * count)),
    );
    const outcome = alertRuleEvaluationOutcome(point, condition);
    const bucket = buckets[index];
    bucket.evaluations += 1;
    if (
      bucket.outcome === null ||
      EVALUATION_OUTCOME_PRIORITY[outcome] >
        EVALUATION_OUTCOME_PRIORITY[bucket.outcome]
    ) {
      bucket.outcome = outcome;
    }
  }
  return buckets;
}

// Walking backwards from the current firing set, each event inverts what it
// did forward. Before a fire or a pending entry the instance was not live, so
// those remove. Before a resolve or a lifecycle close it was firing, so those
// re-add.
//
// Two refinements keep closes honest. A pending_cleared close ended an
// instance that never fired, so it must not re-add. And pending entries must
// remove, or a pause that caught a pending instance reads as firing all the
// way back to the domain edge.
function backwardsRailEffect(
  event: Pick<AlertEventLogRow, "eventType" | "reason">,
): "add" | "remove" | null {
  switch (event.eventType) {
    case "instance_fired":
    case "instance_pending":
      return "remove";
    case "instance_resolved":
      return "add";
    case "instance_closed":
      return event.reason === "pending_cleared" ? null : "add";
    default:
      return null;
  }
}

/**
 * Reconstructs when each instance was firing, as intervals rather than as a
 * state sampled at one instant. Walking backwards, a "remove" is the moment
 * the stretch above it began and an "add" is the moment a stretch below it
 * ended, so each pair closes one interval.
 *
 * `earliestEvidence` is the oldest evaluation the range holds. An instance
 * still open when the walk reaches the start of the range began before it.
 * The rail must not claim firing over a window nothing observed, so the
 * interval starts there, not at the domain edge.
 */
export function buildAlertRuleFiringPeriods(
  events: readonly AlertEventLogRow[],
  currentFiringFingerprints: readonly string[],
  domain: [number, number],
  earliestEvidence: number | null = null,
): AlertRuleFiringPeriod[] {
  const transitions = events
    .flatMap((event) => {
      const effect = backwardsRailEffect(event);
      if (effect === null) return [];
      const timestamp = Date.parse(event.timestamp);
      if (timestamp < domain[0] || timestamp > domain[1]) return [];
      return [{ fingerprint: event.instanceFingerprint, effect, timestamp }];
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const openEnd = new Map<string, number>();
  for (const fingerprint of currentFiringFingerprints) {
    openEnd.set(fingerprint, domain[1]);
  }
  const periods: AlertRuleFiringPeriod[] = [];
  for (const { fingerprint, effect, timestamp } of transitions) {
    if (effect === "remove") {
      const end = openEnd.get(fingerprint);
      if (end === undefined) continue;
      periods.push({ start: timestamp, end, fingerprint });
      openEnd.delete(fingerprint);
    } else if (!openEnd.has(fingerprint)) {
      openEnd.set(fingerprint, timestamp);
    }
  }
  const floor = Math.max(domain[0], earliestEvidence ?? domain[0]);
  for (const [fingerprint, end] of openEnd) {
    periods.push({ start: floor, end, fingerprint });
  }

  return (
    periods
      .map((period) => ({
        fingerprint: period.fingerprint,
        start: Math.max(domain[0], period.start),
        end: Math.min(domain[1], period.end),
      }))
      .filter((period) => period.end >= period.start)
      // An instance that fired and resolved between two evaluations still
      // happened; without a width it would land in no bucket at all.
      .map((period) =>
        period.end === period.start
          ? { ...period, end: period.start + 1 }
          : period,
      )
      .sort((a, b) => a.start - b.start)
  );
}

/** How many separate times the rule was firing, overlapping instances merged. */
export function alertRuleFiringPeriodCount(
  periods: readonly AlertRuleFiringPeriod[],
): number {
  let count = 0;
  let reach = Number.NEGATIVE_INFINITY;
  for (const period of periods) {
    if (period.start > reach) count += 1;
    reach = Math.max(reach, period.end);
  }
  return count;
}

export function buildAlertRuleIncidentRail(
  periods: readonly AlertRuleFiringPeriod[],
  domain: [number, number],
  bucketCount = 60,
): AlertRuleIncidentBucket[] {
  const count = Math.max(1, bucketCount);
  return Array.from({ length: count }, (_, index) => {
    const [start, end] = bucketBounds(domain, index, count);
    // Any overlap, not a sample at one instant: at a 7 day range a bucket
    // spans hours, so sampling would miss every period shorter than it.
    const firing = new Set(
      periods
        .filter((period) => period.start < end && period.end > start)
        .map((period) => period.fingerprint),
    );
    return { start, end, activeInstances: firing.size };
  });
}

function labelsDisplay(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0
    ? "value"
    : entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export function buildAlertRuleChartModel(
  points: readonly AlertingRuleEvaluationPoint[],
) {
  const candidates = new Map<
    string,
    { fingerprint: string; labels: Record<string, string>; count: number }
  >();
  for (const point of points) {
    for (const sample of point.samples) {
      const existing = candidates.get(sample.fingerprint);
      if (existing) existing.count += 1;
      else {
        candidates.set(sample.fingerprint, {
          fingerprint: sample.fingerprint,
          labels: sample.labels,
          count: 1,
        });
      }
    }
  }

  const ranked = [...candidates.values()].sort(
    (a, b) =>
      b.count - a.count ||
      labelsDisplay(a.labels).localeCompare(labelsDisplay(b.labels)) ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
  const series: AlertRuleChartSeries[] = ranked
    .slice(0, ALERT_RULE_CHART_SERIES_LIMIT)
    .map((candidate, index) => ({
      key: `s${index}`,
      fingerprint: candidate.fingerprint,
      label: labelsDisplay(candidate.labels),
      color: SERIES_COLORS[index % SERIES_COLORS.length],
    }));
  const keyByFingerprint = new Map(
    series.map((item) => [item.fingerprint, item.key]),
  );
  const rows: AlertRuleChartRow[] = points.map((point) => {
    const row: AlertRuleChartRow = {
      t: Date.parse(point.t),
      failed: point.failed,
    };
    for (const item of series) row[item.key] = null;
    for (const sample of point.samples) {
      const key = keyByFingerprint.get(sample.fingerprint);
      if (key) row[key] = sample.value;
    }
    return row;
  });

  return {
    rows,
    series,
    seriesTruncated: ranked.length > series.length,
  };
}
