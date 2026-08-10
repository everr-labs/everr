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

export type AlertRuleEvaluationSpan = {
  start: number;
  end: number;
  outcome: "no_data" | "failed";
};

export type AlertRuleEvaluationBucket = {
  start: number;
  end: number;
  outcome: AlertRuleEvaluationOutcome | null;
  evaluations: number;
};

export type AlertRuleIncidentBucket = {
  start: number;
  end: number;
  activeInstances: number;
};

export type AlertRuleLatestCheckSummary = {
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
// did forward: before a fire or a pending entry the instance was not live, so
// they remove; before a resolve or a lifecycle close it was firing, so they
// re-add. Two refinements keep closes honest: a pending_cleared close ended an
// instance that never fired, so it must not re-add, and pending entries must
// remove, or a pause that caught a pending instance would read as firing all
// the way back to the domain edge.
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

export function buildAlertRuleIncidentRail(
  events: readonly AlertEventLogRow[],
  currentFiringFingerprints: readonly string[],
  domain: [number, number],
  bucketCount = 60,
): AlertRuleIncidentBucket[] {
  const count = Math.max(1, bucketCount);
  const transitions = events
    .flatMap((event) => {
      const effect = backwardsRailEffect(event);
      if (effect === null) return [];
      const timestamp = Date.parse(event.timestamp);
      if (timestamp < domain[0] || timestamp > domain[1]) return [];
      return [{ fingerprint: event.instanceFingerprint, effect, timestamp }];
    })
    .sort((a, b) => b.timestamp - a.timestamp);
  const active = new Set(currentFiringFingerprints);
  let transitionIndex = 0;
  const buckets: AlertRuleIncidentBucket[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const [start, end] = bucketBounds(domain, index, count);
    const midpoint = start + (end - start) / 2;
    while (
      transitionIndex < transitions.length &&
      transitions[transitionIndex].timestamp > midpoint
    ) {
      const event = transitions[transitionIndex];
      if (event.effect === "remove") {
        active.delete(event.fingerprint);
      } else {
        active.add(event.fingerprint);
      }
      transitionIndex += 1;
    }
    buckets.unshift({ start, end, activeInstances: active.size });
  }
  return buckets;
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
