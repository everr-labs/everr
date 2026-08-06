import { SERIES_COLORS } from "@/components/dashboards/visualizations/data-utils";
import type { AlertingRuleEvaluationPoint } from "@/data/alerting/types";

export const ALERT_RULE_CHART_SERIES_LIMIT = 12;

export type AlertRuleChartSeries = {
  key: string;
  fingerprint: string;
  label: string;
  color: string;
};

export type AlertRuleChartRow = {
  t: number;
  failed: boolean;
  [key: string]: number | boolean | null;
};

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
