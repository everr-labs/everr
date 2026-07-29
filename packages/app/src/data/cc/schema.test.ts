import { expect, it } from "vitest";
import {
  CcAlertSchema,
  CcChannelSchema,
  CcReceiverSchema,
  CcRuleViewSchema,
  CcSloSchema,
  CcSloStatusSchema,
  CcSloViewSchema,
} from "./schema";

const ruleView = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant: "org_abc",
  spec: {
    sql: "SELECT host FROM t WHERE x > 1",
    interval_secs: 30,
    for_secs: 60,
    label_columns: ["host"],
    value_column: "x",
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

it("parses a RuleView (Rule flattened + health), rollup and suppressed optional", () => {
  const parsed = CcRuleViewSchema.parse({
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
  expect(parsed.rollup?.alert_state).toBe("firing");
  expect(parsed.rollup?.firing_instance_count).toBe(2);
  // Older CC responses omit suppressed, and a pre-SP2 CC omits rollup.
  expect(parsed.spec.suppressed).toBe(false);
  expect(CcRuleViewSchema.parse(ruleView).rollup).toBeUndefined();
});

it("rejects receiver channels that are not a non-empty list of names", () => {
  const receiver = (channels: unknown) => ({
    id: "i",
    tenant: "t",
    name: "oncall",
    channels,
  });
  expect(() => CcReceiverSchema.parse(receiver([]))).toThrow();
  // Receivers reference channel names; inline configs predate that.
  expect(() =>
    CcReceiverSchema.parse(receiver([{ type: "slack", url: "***" }])),
  ).toThrow();
});

it("rejects a channel with an unknown config type", () => {
  expect(() =>
    CcChannelSchema.parse({
      id: "c",
      tenant: "t",
      name: "pigeon",
      config: { type: "carrier-pigeon" },
    }),
  ).toThrow();
});

it("parses an SLO-sourced alert instance (rule carries the SLO uuid, slo marks it)", () => {
  // SLO rows carry the source UUID in both fields.
  const a = CcAlertSchema.parse({
    key: "fp-slo",
    rule: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    slo: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "t",
    status: "firing",
    labels: { service: "checkout", slo_tier: "fast-burn" },
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
    name: "checkout-availability",
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid", label_columns: [] },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
    version: 3,
    paused: false,
  };
  // Reads add timestamps to the mutation shape.
  const view = CcSloViewSchema.parse({
    ...bare,
    updated_at: "2026-07-01T12:00:00Z",
    budget_epoch: "2026-07-01T12:00:00Z",
  });
  expect(view.updated_at).toBe("2026-07-01T12:00:00Z");
  expect(CcSloViewSchema.safeParse(bare).success).toBe(false);
  expect(CcSloSchema.safeParse(bare).success).toBe(true);
});

it("parses the enriched SLO status snapshot (SloStatusOut)", () => {
  const status = CcSloStatusSchema.parse({
    computed_at: "2026-07-18T09:00:00Z",
    payload: {
      window: "30d",
      target_percent: 99.9,
      groups: [
        {
          labels: { service: "checkout" },
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
        },
      ],
      window_computed_at: { "300s": 1752829200, "2592000s": 1752825600 },
    },
    health: { status: "healthy", degraded_since: null, last_error: null },
  });
  expect(status.payload?.groups[0].budget_remaining).toBe(0.42);
  expect(status.payload?.groups[0].firing_tiers[0].tier).toBe("fast-burn");
  expect(status.payload?.groups[0].time_to_exhaustion_secs).toBe(777600);
  expect(status.health.status).toBe("healthy");
});

it("parses a scalar-group snapshot missing the enrichment (legacy row served raw)", () => {
  // Legacy rows can lack enrichment fields.
  const status = CcSloStatusSchema.parse({
    computed_at: "2026-07-18T09:00:00Z",
    payload: {
      window: "30d",
      target_percent: 99.9,
      groups: [
        {
          labels: {},
          sli: null,
          budget_remaining: null,
          tiers: [
            { name: "fast-burn", long_burn_rate: null, short_burn_rate: null },
          ],
        },
      ],
      window_computed_at: {},
    },
    health: {
      status: "degraded",
      degraded_since: "2026-07-18T08:00:00Z",
      last_error: "query failed: boom",
    },
  });
  const group = status.payload?.groups[0];
  expect(group?.time_to_exhaustion_secs).toBeNull();
  expect(group?.firing_tiers).toEqual([]);
  expect(group?.tiers[0].long_window_valid).toBeNull();
  expect(status.health.status).toBe("degraded");
});

it("degrades an unparseable stored payload to null instead of failing the status read", () => {
  const status = CcSloStatusSchema.parse({
    computed_at: "2026-07-18T09:00:00Z",
    payload: { some: "legacy-shape" },
    health: { status: "healthy", degraded_since: null, last_error: null },
  });
  expect(status.payload).toBeNull();
});
