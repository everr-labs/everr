import { expect, it } from "vitest";
import {
  AlertingAlertSchema,
  AlertingChannelSchema,
  AlertingReceiverSchema,
  AlertingRuleViewSchema,
  AlertingSloSchema,
  AlertingSloSpecSchema,
  AlertingSloStatusSchema,
  AlertingSloViewSchema,
} from "./schema";

const ruleView = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant: "org_abc",
  repoid: "repo-1",
  previewId: "demo",
  name: "default/checkout-errors",
  spec: {
    sql: "SELECT host, x AS value FROM t",
    interval_secs: 30,
    for_secs: 60,
    label_columns: ["host"],
    condition: { operator: "gt", threshold: 1 },
    severity: "critical",
    annotations: { runbook: "https://r" },
    resolve_after: 1,
  },
  version: 1,
  paused: false,
  updated_at: "2026-06-14T12:00:00Z",
  health: {
    status: "healthy",
    consecutive_failures: 0,
    degraded_since: null,
    last_error: null,
    last_error_at: null,
  },
};

it("parses a complete RuleView", () => {
  const parsed = AlertingRuleViewSchema.parse({
    ...ruleView,
    rollup: {
      alert_state: "firing",
      firing_instance_count: 2,
      last_fired_at: "2026-06-14T12:00:00Z",
      last_resolved_at: null,
      last_seen_at: "2026-06-14T12:03:00Z",
      last_row_count: 5,
    },
  });
  expect(parsed.spec.severity).toBe("critical");
  expect(parsed.health.status).toBe("healthy");
  expect(parsed.rollup.alert_state).toBe("firing");
  expect(parsed.rollup.firing_instance_count).toBe(2);
  expect(parsed.spec.suppressed).toBe(false);
  expect(AlertingRuleViewSchema.safeParse(ruleView).success).toBe(false);
});

// `name` is what the as-code reconciler matches and prunes on. Defaulting a
// missing one to "" collapses every rule onto a single scope-map entry, so the
// next apply duplicates every document and prunes only one original. Failing the
// parse is the safe answer.
it("rejects a rule with no identity rather than defaulting it", () => {
  for (const missing of ["name", "previewId"] as const) {
    const { [missing]: _omitted, ...rest } = ruleView;
    expect(() => AlertingRuleViewSchema.parse(rest)).toThrow();
  }
});

it("rejects receiver channels that are not a non-empty list of names", () => {
  const receiver = (channels: unknown) => ({
    id: "i",
    tenant: "t",
    name: "oncall",
    channels,
  });
  expect(() => AlertingReceiverSchema.parse(receiver([]))).toThrow();
  // Receivers reference channel names; inline configs predate that.
  expect(() =>
    AlertingReceiverSchema.parse(receiver([{ type: "slack", url: "***" }])),
  ).toThrow();
});

it("rejects a channel with an unknown config type", () => {
  expect(() =>
    AlertingChannelSchema.parse({
      id: "c",
      tenant: "t",
      name: "pigeon",
      config: { type: "carrier-pigeon" },
    }),
  ).toThrow();
});

it("parses an SLO-sourced alert instance (rule carries the SLO uuid, slo marks it)", () => {
  // SLO rows carry the source UUID in both fields.
  const a = AlertingAlertSchema.parse({
    key: "fp-slo",
    rule: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    slo: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "t",
    status: "firing",
    labels: { slo_tier: "fast-burn" },
    value: 14.6,
    active_since: "2026-06-14T12:00:00Z",
    last_seen: "2026-06-14T12:03:00Z",
    absent_count: 0,
  });
  expect(a.slo).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
});

it("SloView (list/get) requires updated_at; the bare Slo (mutations) has none", () => {
  const bare = {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "org1",
    repoid: "repo-1",
    previewId: null,
    name: "default/checkout-availability",
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid" },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
    version: 3,
    paused: false,
  };
  // Reads add timestamps to the mutation shape.
  const view = AlertingSloViewSchema.parse({
    ...bare,
    updated_at: "2026-07-01T12:00:00Z",
    budget_epoch: "2026-07-01T12:00:00Z",
  });
  expect(view.updated_at).toBe("2026-07-01T12:00:00Z");
  expect(AlertingSloViewSchema.safeParse(bare).success).toBe(false);
  expect(AlertingSloSchema.safeParse(bare).success).toBe(true);
});

it("rejects unknown SLI fields", () => {
  expect(() =>
    AlertingSloSpecSchema.parse({
      sli: {
        sql: "SELECT 1 AS good, 1 AS valid",
        unexpected: [],
      },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
    }),
  ).toThrow();
});

it("parses the enriched SLO status snapshot (SloStatusOut)", () => {
  const status = AlertingSloStatusSchema.parse({
    computed_at: "2026-07-18T09:00:00Z",
    payload: {
      window: "30d",
      target_percent: 99.9,
      sli: 0.9992,
      budget_remaining: 0.42,
      tiers: [
        {
          name: "fast-burn",
          long_burn_rate: 1.4,
          short_burn_rate: 0.9,
          long_window_valid: 120000,
        },
        {
          name: "ticket",
          long_burn_rate: null,
          short_burn_rate: null,
          long_window_valid: null,
        },
      ],
      time_to_exhaustion_secs: 777600,
      firing_tiers: [{ tier: "fast-burn", status: "firing" }],
      window_computed_at: { "300s": 1752829200, "2592000s": 1752825600 },
    },
    health: { status: "healthy", degraded_since: null, last_error: null },
  });
  expect(status.payload?.budget_remaining).toBe(0.42);
  expect(status.payload?.firing_tiers[0].tier).toBe("fast-burn");
  expect(status.payload?.time_to_exhaustion_secs).toBe(777600);
  expect(status.health.status).toBe("healthy");
});

it("rejects an incomplete SLO status snapshot", () => {
  expect(() =>
    AlertingSloStatusSchema.parse({
      computed_at: "2026-07-18T09:00:00Z",
      payload: {
        window: "30d",
        target_percent: 99.9,
        sli: null,
        budget_remaining: null,
        tiers: [
          { name: "fast-burn", long_burn_rate: null, short_burn_rate: null },
        ],
        window_computed_at: {},
      },
      health: {
        status: "degraded",
        degraded_since: "2026-07-18T08:00:00Z",
        last_error: "query failed: boom",
      },
    }),
  ).toThrow();
});

it("rejects an invalid stored status payload", () => {
  expect(() =>
    AlertingSloStatusSchema.parse({
      computed_at: "2026-07-18T09:00:00Z",
      payload: { some: "invalid-shape" },
      health: { status: "healthy", degraded_since: null, last_error: null },
    }),
  ).toThrow();
});
