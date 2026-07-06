import { expect, it } from "vitest";
import {
  CcAlertSchema,
  CcEventSchema,
  CcReceiverSchema,
  CcRouteSchema,
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

it("parses a receiver channel tagged union", () => {
  expect(
    CcReceiverSchema.parse({
      id: "i",
      tenant: "t",
      name: "oncall",
      channel: { type: "slack", url: "***" },
    }).channel.type,
  ).toBe("slack");
  expect(
    CcReceiverSchema.parse({
      id: "i",
      tenant: "t",
      name: "ops",
      channel: { type: "email", to: ["a@b.c"] },
    }).channel.type,
  ).toBe("email");
});

it("parses receiver annotations (absent stays undefined, present round-trips)", () => {
  // An absent map (older CC, or a receiver written before the field existed).
  expect(
    CcReceiverSchema.parse({
      id: "i",
      tenant: "t",
      name: "oncall",
      channel: { type: "slack", url: "***" },
    }).annotations,
  ).toBeUndefined();
  // Ownership markers stamped by the as-code reconciler round-trip verbatim.
  expect(
    CcReceiverSchema.parse({
      id: "i",
      tenant: "t",
      name: "oncall",
      channel: { type: "slack", url: "***" },
      annotations: { "everr.repoid": "repo1", "everr.managed": "as-code" },
    }).annotations,
  ).toEqual({ "everr.repoid": "repo1", "everr.managed": "as-code" });
});

it("parses a telegram channel", () => {
  expect(
    CcReceiverSchema.parse({
      id: "r",
      tenant: "t",
      name: "everr-default-telegram",
      channel: { type: "telegram", bot_token: "x", chat_ids: ["-100"] },
    }).channel.type,
  ).toBe("telegram");
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
