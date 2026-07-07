import { expect, it } from "vitest";
import {
  CcAlertSchema,
  CcChannelSchema,
  CcEventSchema,
  CcReceiverSchema,
  CcRouteSchema,
  CcRuleSpecSchema,
  CcRulesPageSchema,
  CcRuleViewSchema,
  CcSilenceSchema,
  CcSubscriptionSchema,
} from "./schema";

it("normalizes CC's array timestamp format to an ISO string", () => {
  // Shape observed from a live CC `/v1/alerts` response (time-crate default serde).
  const a = CcAlertSchema.parse({
    key: "k",
    rule: "r",
    tenant: "t",
    status: "firing",
    labels: { svc: "always" },
    value: 1.0,
    active_since: [2026, 167, 15, 53, 50, 186382000, 0, 0, 0],
    last_seen: [2026, 167, 15, 54, 20, 347598000, 0, 0, 0],
    absent_count: 0,
  });
  expect(a.active_since).toBe("2026-06-16T15:53:50.186Z");
  expect(a.last_seen).toBe("2026-06-16T15:54:20.347Z");
});

it("still accepts RFC-3339 string timestamps", () => {
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

it("parses a silence and an SSE event", () => {
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

  expect(
    CcEventSchema.parse({
      tenant: "t",
      rule: "r",
      instance_key: "k",
      status: "firing",
      labels: {},
      value: 1,
      severity: "warning",
      annotations: {},
      eval_ts: "2026-06-14T12:03:00Z",
    }).status,
  ).toBe("firing");
});

it("parses an SSE event carrying suppression and evidence", () => {
  const e = CcEventSchema.parse({
    tenant: "t",
    rule: "r",
    instance_key: "k",
    status: "firing",
    labels: { host: "web-1" },
    value: 1,
    severity: "warning",
    annotations: {},
    eval_ts: "2026-06-14T12:03:00Z",
    suppressed: true,
    evidence: { status_code: 500, path: "/checkout" },
    evidence_truncated: true,
  });
  expect(e.suppressed).toBe(true);
  expect(e.evidence).toEqual({ status_code: 500, path: "/checkout" });
  expect(e.evidence_truncated).toBe(true);
});

it("defaults suppression/evidence on SSE frames from an older CC", () => {
  const e = CcEventSchema.parse({
    tenant: "t",
    rule: "r",
    instance_key: "k",
    status: "resolved",
    labels: {},
    value: null,
    severity: "info",
    annotations: {},
    eval_ts: "2026-06-14T12:03:00Z",
  });
  expect(e.suppressed).toBe(false);
  expect(e.evidence).toBeNull();
  expect(e.evidence_truncated).toBe(false);
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

it("normalizes a subscription's array created_at to an ISO string", () => {
  const s = CcSubscriptionSchema.parse({
    id: "sub1",
    tenant: "t",
    webhook_url: "https://example.com/hook",
    created_at: [2026, 167, 15, 53, 50, 186382000, 0, 0, 0],
  });
  expect(s.created_at).toBe("2026-06-16T15:53:50.186Z");
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
