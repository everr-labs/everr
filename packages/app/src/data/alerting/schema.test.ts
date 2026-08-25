import { expect, it } from "vitest";
import {
  ALERTING_MATCHER_LABEL_MAX,
  ALERTING_MATCHER_VALUE_MAX,
  ALERTING_MATCHERS_MAX,
  AlertingRuleViewSchema,
  AlertingSilenceInputSchema,
} from "./schema";

const ruleView = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant: "org_abc",
  repoid: "repo-1",
  previewId: "demo",
  name: "default/checkout-errors",
  notifications: { channels: ["team-slack"] },
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

it("rejects any silence op that is not exact matching", () => {
  const silence = (op: string) => ({
    matchers: [{ label: "team", op, value: "^pay.*" }],
    starts_at: "2026-07-01T11:00:00Z",
    ends_at: "2026-07-01T13:00:00Z",
  });
  for (const op of ["regex", "notregex", "glob"]) {
    const result = AlertingSilenceInputSchema.safeParse(silence(op));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("eq");
  }
});

it("bounds matcher counts and label and value lengths", () => {
  const matchers = (count: number, value = "pay") =>
    Array.from({ length: count }, () => ({ label: "team", op: "eq", value }));

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
  expect(
    AlertingSilenceInputSchema.safeParse(
      silence([
        {
          label: "x".repeat(ALERTING_MATCHER_LABEL_MAX + 1),
          op: "eq",
          value: "pay",
        },
      ]),
    ).success,
  ).toBe(false);
});

it("drops a client-supplied silence author", () => {
  const parsed = AlertingSilenceInputSchema.parse({
    matchers: [{ label: "team", op: "eq", value: "pay" }],
    starts_at: "2026-07-01T11:00:00Z",
    ends_at: "2026-07-01T13:00:00Z",
    author: "someone else",
  });
  expect(parsed).not.toHaveProperty("author");
});
