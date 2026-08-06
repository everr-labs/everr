import { describe, expect, it } from "vitest";
import type { AlertingRuleEvaluationPoint } from "@/data/alerting/types";
import {
  ALERT_RULE_CHART_SERIES_LIMIT,
  alertRuleEvaluationOutcome,
  alertRuleRailBucketCount,
  buildAlertRuleChartModel,
  buildAlertRuleEvaluationRail,
  buildAlertRuleEvaluationSpans,
  buildAlertRuleIncidentRail,
  summarizeAlertRuleLatestCheck,
} from "./alert-rule-chart-data";

const point = (
  t: string,
  samples: AlertingRuleEvaluationPoint["samples"],
): AlertingRuleEvaluationPoint => ({
  t,
  samples,
  failed: false,
  error: null,
  row_count: samples.length,
});

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

describe("alert rule evaluation states", () => {
  const condition = { operator: "gt" as const, threshold: 10 };
  const domain: [number, number] = [
    Date.parse("2026-08-06T12:00:00Z"),
    Date.parse("2026-08-06T12:04:00Z"),
  ];

  it("distinguishes healthy, breached, no-data, and failed checks", () => {
    expect(
      alertRuleEvaluationOutcome(
        point("2026-08-06T12:00:00Z", [
          { fingerprint: "api", labels: {}, value: 8 },
        ]),
        condition,
      ),
    ).toBe("healthy");
    expect(
      alertRuleEvaluationOutcome(
        point("2026-08-06T12:01:00Z", [
          { fingerprint: "api", labels: {}, value: 12 },
        ]),
        condition,
      ),
    ).toBe("breached");
    expect(
      alertRuleEvaluationOutcome(point("2026-08-06T12:02:00Z", []), condition),
    ).toBe("no_data");
    expect(
      alertRuleEvaluationOutcome(
        {
          ...point("2026-08-06T12:03:00Z", []),
          failed: true,
          error: "timeout",
        },
        condition,
      ),
    ).toBe("failed");
    expect(
      alertRuleEvaluationOutcome(
        {
          ...point("2026-08-06T12:03:00Z", []),
          row_count: null,
        },
        condition,
      ),
    ).toBe("unknown");
  });

  it("summarizes each series in the latest check independently", () => {
    expect(
      summarizeAlertRuleLatestCheck(
        point("2026-08-06T12:00:00Z", [
          { fingerprint: "breached", labels: {}, value: 12 },
          { fingerprint: "healthy", labels: {}, value: 8 },
          { fingerprint: "no-data", labels: {}, value: null },
        ]),
        condition,
      ),
    ).toEqual({ total: 3, breached: 1, healthy: 1, noData: 1 });
  });

  it("builds bounded missing-data spans and outcome buckets", () => {
    const points = [
      point("2026-08-06T12:01:00Z", []),
      point("2026-08-06T12:02:00Z", []),
      point("2026-08-06T12:03:00Z", [
        { fingerprint: "api", labels: {}, value: 12 },
      ]),
    ];

    expect(
      buildAlertRuleEvaluationSpans(points, condition, domain, 60_000),
    ).toEqual([
      {
        start: Date.parse("2026-08-06T12:00:30Z"),
        end: Date.parse("2026-08-06T12:02:30Z"),
        outcome: "no_data",
      },
    ]);
    expect(
      buildAlertRuleEvaluationRail(points, condition, domain, 4).map(
        (bucket) => bucket.outcome,
      ),
    ).toEqual([null, "no_data", "no_data", "breached"]);
  });

  it("keeps rail buckets at least as wide as the evaluation interval", () => {
    const intervalMs = 60_000;
    const shortDomain: [number, number] = [domain[0], domain[0] + 30_000];
    const unevenDomain: [number, number] = [
      domain[0],
      domain[0] + intervalMs * 3.5,
    ];

    expect(alertRuleRailBucketCount(shortDomain, intervalMs)).toBe(1);
    expect(alertRuleRailBucketCount(unevenDomain, intervalMs)).toBe(3);
    expect(alertRuleRailBucketCount(domain, 1)).toBe(60);

    const rail = buildAlertRuleEvaluationRail(
      [],
      condition,
      unevenDomain,
      alertRuleRailBucketCount(unevenDomain, intervalMs),
    );
    expect(rail).toHaveLength(3);
    expect(
      rail.every((bucket) => bucket.end - bucket.start >= intervalMs),
    ).toBe(true);
  });

  it("reconstructs incident state backwards from current instances", () => {
    const event = (
      timestamp: string,
      eventType: "instance_fired" | "instance_resolved",
    ) => ({
      timestamp,
      eventType,
      slug: "default/api",
      instanceFingerprint: "api",
      labels: {},
      severity: "critical",
      suppressed: false,
      silenced: false,
      inhibited: false,
      deliveryTargets: [],
      evidence: null,
      evidenceTruncated: false,
    });

    const rail = buildAlertRuleIncidentRail(
      [
        event("2026-08-06T12:01:00Z", "instance_fired"),
        event("2026-08-06T12:03:00Z", "instance_resolved"),
      ],
      [],
      domain,
      4,
    );

    expect(rail.map((bucket) => bucket.activeInstances)).toEqual([0, 1, 1, 0]);
  });
});
