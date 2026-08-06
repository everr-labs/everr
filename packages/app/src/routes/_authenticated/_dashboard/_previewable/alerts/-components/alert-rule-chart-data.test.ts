import { describe, expect, it } from "vitest";
import type { AlertingRuleEvaluationPoint } from "@/data/alerting/types";
import {
  ALERT_RULE_CHART_SERIES_LIMIT,
  buildAlertRuleChartModel,
} from "./alert-rule-chart-data";

const point = (
  t: string,
  samples: AlertingRuleEvaluationPoint["samples"],
): AlertingRuleEvaluationPoint => ({ t, samples, failed: false });

describe("buildAlertRuleChartModel", () => {
  it("creates one stable series per label fingerprint and keeps gaps", () => {
    const model = buildAlertRuleChartModel([
      point("2026-08-06T12:00:00Z", [
        { fingerprint: "api", labels: { service: "api" }, value: 8 },
        { fingerprint: "worker", labels: { service: "worker" }, value: 2 },
      ]),
      point("2026-08-06T12:01:00Z", [
        { fingerprint: "api", labels: { service: "api" }, value: 9 },
      ]),
    ]);

    expect(model.series.map((series) => series.label)).toEqual([
      "service=api",
      "service=worker",
    ]);
    expect(model.rows[1]).toMatchObject({ s0: 9, s1: null });
    expect(model.seriesTruncated).toBe(false);
  });

  it("limits the visible series by frequency", () => {
    const samples = Array.from(
      { length: ALERT_RULE_CHART_SERIES_LIMIT + 1 },
      (_, i) => ({
        fingerprint: `fp-${i}`,
        labels: { service: `service-${i}` },
        value: i,
      }),
    );
    const model = buildAlertRuleChartModel([
      point("2026-08-06T12:00:00Z", samples),
    ]);

    expect(model.series).toHaveLength(ALERT_RULE_CHART_SERIES_LIMIT);
    expect(model.seriesTruncated).toBe(true);
  });
});
