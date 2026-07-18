import { expect, it } from "vitest";
import {
  CcAlertSchema,
  CcChannelSchema,
  CcReceiverSchema,
  CcRouteSchema,
  CcRuleSpecSchema,
  CcRulesPageSchema,
  CcRuleViewSchema,
  CcSilenceSchema,
  CcSloSchema,
  CcSloStatusSchema,
  CcSloTestResultSchema,
  CcSloViewSchema,
  CcSubscriptionSchema,
} from "./schema";

it("accepts RFC-3339 string timestamps", () => {
  const a = CcAlertSchema.parse({
    key: "k",
    rule: "r",
    tenant: "t",
    status: "pending",
    labels: {},
    value: null,
    active_since: null,
    last_seen: "2026-06-14T12:03:00Z",
    absent_count: 0,
  });
  expect(a.last_seen).toBe("2026-06-14T12:03:00Z");
  expect(a.active_since).toBeNull();
});

it("parses a RuleView (Rule flattened + health)", () => {
  const parsed = CcRuleViewSchema.parse({
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
  // A pre-suppression CC omits the flag; the default keeps the parse working
  // and downstream reads (fromCcRuleSpec, fingerprints) uniform.
  expect(parsed.spec.suppressed).toBe(false);
});

it("passes an explicit suppressed flag through the rule spec", () => {
  const parsed = CcRuleViewSchema.parse({
    id: "11111111-1111-1111-1111-111111111111",
    tenant: "org_abc",
    spec: {
      sql: "SELECT 1",
      interval_secs: 30,
      for_secs: 0,
      label_columns: [],
      value_column: null,
      severity: "info",
      annotations: {},
      resolve_after: 1,
      suppressed: true,
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
  });
  expect(parsed.spec.suppressed).toBe(true);
});

it("parses a RuleView from a pre-SP2 CC that omits rollup", () => {
  const parsed = CcRuleViewSchema.parse({
    id: "11111111-1111-1111-1111-111111111111",
    tenant: "org_abc",
    spec: {
      sql: "SELECT host FROM t WHERE x > 1",
      interval_secs: 30,
      for_secs: 60,
      label_columns: ["host"],
      value_column: "x",
      severity: "critical",
      annotations: {},
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
  });
  expect(parsed.rollup).toBeUndefined();
});

it("parses an alert instance with nullable value/timestamps", () => {
  const a = CcAlertSchema.parse({
    key: "deadbeef",
    rule: "r",
    tenant: "t",
    status: "pending",
    labels: { host: "web-1" },
    value: null,
    active_since: null,
    last_seen: "2026-06-14T12:03:00Z",
    absent_count: 0,
  });
  expect(a.status).toBe("pending");
  expect(a.value).toBeNull();
});

it("parses receiver channels as a list of channel names", () => {
  const multi = CcReceiverSchema.parse({
    id: "i",
    tenant: "t",
    name: "oncall",
    channels: ["team-slack", "ops-mail"],
  });
  expect(multi.channels).toEqual(["team-slack", "ops-mail"]);
});

it("rejects a receiver with an empty channels list", () => {
  expect(() =>
    CcReceiverSchema.parse({
      id: "i",
      tenant: "t",
      name: "oncall",
      channels: [],
    }),
  ).toThrow();
});

it("rejects pre-named-channels inline config objects in receiver channels", () => {
  // The engine's receivers carry channel NAMES now; a payload from before the
  // migration (inline config objects) must fail loudly, not half-parse.
  expect(() =>
    CcReceiverSchema.parse({
      id: "i",
      tenant: "t",
      name: "oncall",
      channels: [{ type: "slack", url: "***" }],
    }),
  ).toThrow();
});

it("parses receiver annotations (absent stays undefined, present round-trips)", () => {
  // An absent map (older CC, or a receiver written before the field existed).
  expect(
    CcReceiverSchema.parse({
      id: "i",
      tenant: "t",
      name: "oncall",
      channels: ["team-slack"],
    }).annotations,
  ).toBeUndefined();
  // A present map round-trips verbatim (including markers stamped by the
  // retired as-code receiver flow, which existing receivers may still carry).
  expect(
    CcReceiverSchema.parse({
      id: "i",
      tenant: "t",
      name: "oncall",
      channels: ["team-slack"],
      annotations: { "everr.repoid": "repo1", team: "core" },
    }).annotations,
  ).toEqual({ "everr.repoid": "repo1", team: "core" });
});

it("parses a named channel with its tagged config (redacted secrets included)", () => {
  const ch = CcChannelSchema.parse({
    id: "c",
    tenant: "t",
    name: "team-slack",
    config: { type: "slack", url: "***" },
  });
  expect(ch.name).toBe("team-slack");
  expect(ch.config.type).toBe("slack");
  expect(
    CcChannelSchema.parse({
      id: "c",
      tenant: "t",
      name: "ops-mail",
      config: { type: "email", to: ["a@b.c"] },
    }).config.type,
  ).toBe("email");
});

it("parses a telegram channel config", () => {
  expect(
    CcChannelSchema.parse({
      id: "c",
      tenant: "t",
      name: "everr-default-telegram",
      config: { type: "telegram", bot_token: "x", chat_ids: ["-100"] },
    }).config.type,
  ).toBe("telegram");
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

it("parses a route with nullable group settings", () => {
  const r = CcRouteSchema.parse({
    id: "i",
    tenant: "t",
    matchers: [{ label: "severity", op: "eq", value: "critical" }],
    receiver: "oncall",
    continue: false,
    priority: 0,
    group_by: ["rule", "severity"],
    group_wait_secs: 10,
    group_interval_secs: 300,
    repeat_interval_secs: 3600,
  });
  expect(r.matchers[0].op).toBe("eq");
  expect(r.repeat_interval_secs).toBe(3600);
});

it("parses a route with a null repeat_interval_secs (never re-notify)", () => {
  const r = CcRouteSchema.parse({
    id: "i",
    tenant: "t",
    matchers: [],
    receiver: "oncall",
    continue: false,
    priority: 0,
    group_by: null,
    group_wait_secs: null,
    group_interval_secs: null,
    repeat_interval_secs: null,
  });
  expect(r.repeat_interval_secs).toBeNull();
});

it("parses a silence", () => {
  expect(
    CcSilenceSchema.parse({
      id: "i",
      tenant: "t",
      matchers: [{ label: "host", op: "eq", value: "web-1" }],
      starts_at: "2026-06-14T00:00:00Z",
      ends_at: "2026-06-14T01:00:00Z",
      comment: "m",
      author: "you",
      created_at: "2026-06-14T00:00:00Z",
    }).author,
  ).toBe("you");
});

it("parses the paginated rules envelope with and without a next cursor", () => {
  const item = {
    id: "11111111-1111-1111-1111-111111111111",
    tenant: "org_abc",
    spec: {
      sql: "SELECT 1",
      interval_secs: 30,
      for_secs: 0,
      label_columns: [],
      value_column: null,
      severity: "info",
      annotations: {},
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
  const page = CcRulesPageSchema.parse({
    items: [item],
    next_cursor: "djE6MTIzOmFiYw",
  });
  expect(page.items).toHaveLength(1);
  expect(page.next_cursor).toBe("djE6MTIzOmFiYw");

  const last = CcRulesPageSchema.parse({ items: [], next_cursor: null });
  expect(last.items).toEqual([]);
  expect(last.next_cursor).toBeNull();
});

it("parses a subscription with an RFC-3339 created_at", () => {
  const s = CcSubscriptionSchema.parse({
    id: "sub1",
    tenant: "t",
    webhook_url: "https://example.com/hook",
    created_at: "2026-06-14T12:00:00Z",
  });
  expect(s.webhook_url).toBe("https://example.com/hook");
  expect(s.created_at).toBe("2026-06-14T12:00:00Z");
});

it("parses an SLO-sourced alert instance (rule carries the SLO uuid, slo marks it)", () => {
  // CC's SourceIdWire: `rule` always carries the uuid — the SLO's for SLO
  // rows — and `slo` is additionally present for SLO sources.
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
  // Rule-sourced rows omit the field entirely (skip_serializing_if).
  expect(
    CcAlertSchema.parse({
      key: "fp-rule",
      rule: "r",
      tenant: "t",
      status: "firing",
      labels: {},
      value: null,
      active_since: null,
      last_seen: null,
      absent_count: 0,
    }).slo,
  ).toBeUndefined();
});

it("parses an Slo as CC serializes it (OpenSLO field names, optional fields absent)", () => {
  // Shaped like domain/slo.rs: serde renames targetPercent/timeWindow/
  // isRolling; min_valid_events/tiers/calendar are skip_serializing_if None.
  const slo = CcSloSchema.parse({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "org1",
    name: "checkout-availability",
    spec: {
      sli: {
        sql: "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
        label_columns: ["service"],
      },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
    version: 3,
    paused: false,
  });
  expect(slo.spec.targetPercent).toBe(99.9);
  expect(slo.spec.timeWindow.duration).toBe("30d");
  expect(slo.spec.min_valid_events).toBeUndefined();
  expect(slo.spec.tiers).toBeUndefined();
});

it("parses an Slo with explicit tiers and min_valid_events", () => {
  const slo = CcSloSchema.parse({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    tenant: "org1",
    name: "latency",
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid", label_columns: [] },
      targetPercent: 99.5,
      timeWindow: { duration: "7d", isRolling: true },
      min_valid_events: 1000,
      tiers: [
        {
          name: "fast-burn",
          long_window: "1h",
          short_window: "5m",
          burn_rate: 14.4,
          severity: "critical",
        },
      ],
      annotations: { "everr.name": "latency-slo" },
      suppressed: true,
    },
    version: 1,
    paused: true,
  });
  expect(slo.spec.tiers).toHaveLength(1);
  expect(slo.spec.tiers?.[0].severity).toBe("critical");
  expect(slo.spec.min_valid_events).toBe(1000);
  expect(slo.paused).toBe(true);
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
  // GET /v1/slos(/:id) serializes the SloView: bare Slo + rfc3339 updated_at.
  const view = CcSloViewSchema.parse({
    ...bare,
    updated_at: "2026-07-01T12:00:00Z",
  });
  expect(view.updated_at).toBe("2026-07-01T12:00:00Z");
  // The column is NOT NULL and always serialized on the view, so parsing must
  // fail rather than silently degrade when it goes missing.
  expect(CcSloViewSchema.safeParse(bare).success).toBe(false);
  expect(CcSloSchema.safeParse(bare).success).toBe(true);
});

it("parses the enriched SLO status snapshot (SloStatusOut)", () => {
  // Shaped like engine/slo_math.rs SloStatusPayload plus api/slos.rs
  // enrich_status_payload's per-group time_to_exhaustion_secs/firing_tiers,
  // with stores/pg.rs SloHealth as the sibling.
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
  // enrich_status_payload serves legacy rows unmodified, so per-group
  // enrichment fields can be absent; a pre-long_window_valid tier too.
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

it("parses the SLO test-run result (per-group good/valid/sli)", () => {
  // Shaped like api/slos.rs `test`: sli is null when valid == 0.
  const result = CcSloTestResultSchema.parse({
    matched: 2,
    groups: [
      { labels: { service: "checkout" }, good: 998, valid: 1000, sli: 0.998 },
      { labels: { service: "idle" }, good: 0, valid: 0, sli: null },
    ],
  });
  expect(result.matched).toBe(2);
  expect(result.groups[1].sli).toBeNull();
});

it("parses a rule spec with max_interval_secs and omits it when absent", () => {
  const minimal = {
    sql: "SELECT 1",
    interval_secs: 30,
    for_secs: 0,
    label_columns: [],
    severity: "info",
  };

  // With max_interval_secs present, it should round-trip
  const withMaxInterval = CcRuleSpecSchema.parse({
    ...minimal,
    max_interval_secs: 3600,
  });
  expect(withMaxInterval.max_interval_secs).toBe(3600);

  // Without max_interval_secs, it should be undefined
  const withoutMaxInterval = CcRuleSpecSchema.parse(minimal);
  expect(withoutMaxInterval.max_interval_secs).toBeUndefined();
});
