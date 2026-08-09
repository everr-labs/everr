import { expect, it } from "vitest";
import {
  ALERTING_MATCHER_LABEL_MAX,
  ALERTING_MATCHER_VALUE_MAX,
  ALERTING_MATCHERS_MAX,
  AlertingChannelSchema,
  AlertingReceiverSchema,
  AlertingRouteInputSchema,
  AlertingRuleViewSchema,
  AlertingSilenceInputSchema,
} from "./schema";

const ruleView = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant: "org_abc",
  repoid: "repo-1",
  previewId: "demo",
  name: "default/checkout-errors",
  notification_channels: ["team-slack"],
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
      next_evaluation_at: "2026-06-14T12:03:30Z",
      last_row_count: 5,
    },
  });
  expect(parsed.spec.severity).toBe("critical");
  expect(parsed.health.status).toBe("healthy");
  expect(parsed.rollup.alert_state).toBe("firing");
  expect(parsed.rollup.firing_instance_count).toBe(2);
  expect(parsed.spec.suppressed).toBe(false);
  expect(AlertingRuleViewSchema.safeParse(ruleView).success).toBe(false);
  expect(
    AlertingRuleViewSchema.safeParse({
      ...parsed,
      updated_at: "not-a-timestamp",
    }).success,
  ).toBe(false);
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

const routeInput = (matchers: unknown) => ({
  matchers,
  receiver: "oncall",
  continue: false,
  priority: 1,
  group_by: null,
  group_wait_secs: null,
  group_interval_secs: null,
  repeat_interval_secs: null,
});

it("rejects the removed regex ops and names them in the error", () => {
  for (const op of ["regex", "notregex"] as const) {
    const result = AlertingRouteInputSchema.safeParse(
      routeInput([{ label: "team", op, value: "^pay.*" }]),
    );
    expect(result.success).toBe(false);
    const message = result.error?.issues[0]?.message ?? "";
    expect(message).toContain(op);
    expect(message).toContain("removed");
    expect(message).toContain("eq");
  }

  const unknown = AlertingRouteInputSchema.safeParse(
    routeInput([{ label: "team", op: "glob", value: "pay*" }]),
  );
  expect(unknown.success).toBe(false);
  expect(unknown.error?.issues[0]?.message).toContain("eq");
});

it("bounds matcher counts and label and value lengths", () => {
  const matchers = (count: number, value = "pay") =>
    Array.from({ length: count }, () => ({ label: "team", op: "eq", value }));

  expect(
    AlertingRouteInputSchema.safeParse(
      routeInput([
        {
          label: "x".repeat(ALERTING_MATCHER_LABEL_MAX + 1),
          op: "eq",
          value: "pay",
        },
      ]),
    ).success,
  ).toBe(false);

  expect(
    AlertingRouteInputSchema.safeParse(
      routeInput(matchers(ALERTING_MATCHERS_MAX)),
    ).success,
  ).toBe(true);
  expect(
    AlertingRouteInputSchema.safeParse(
      routeInput(matchers(ALERTING_MATCHERS_MAX + 1)),
    ).success,
  ).toBe(false);

  const silence = (matchers: unknown) => ({
    matchers,
    starts_at: "2026-07-01T11:00:00Z",
    ends_at: "2026-07-01T13:00:00Z",
  });
  expect(
    AlertingSilenceInputSchema.safeParse(
      silence(matchers(1, "x".repeat(ALERTING_MATCHER_VALUE_MAX))),
    ).success,
  ).toBe(true);
  expect(
    AlertingSilenceInputSchema.safeParse(
      silence(matchers(1, "x".repeat(ALERTING_MATCHER_VALUE_MAX + 1))),
    ).success,
  ).toBe(false);
  expect(
    AlertingSilenceInputSchema.safeParse(
      silence(matchers(ALERTING_MATCHERS_MAX + 1)),
    ).success,
  ).toBe(false);
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
