import { describe, expect, it, vi } from "vitest";

// Only so that importing the row modules for their pure halves does not build
// a real database pool. Nothing here answers a query: the loaders are covered
// against real stores by the alerting integration suites.
vi.mock("@/db/client", () => ({
  db: {},
  pool: {},
  runInTransaction: () => Promise.resolve(),
}));

import type { AlertingRuleSpec } from "@/data/alerting/types";
import {
  type AlertDetailInput,
  assembleAlertDetail,
  assembleRuleStateHistory,
  assembleTriage,
  type RuleStateHistoryInput,
  type TriageInput,
} from "./assemble";
import { formatClock } from "./format";
import type { NotificationFact } from "./notifications";
import type { DefinitionRow, InstanceRow } from "./rules";
import type { SilenceRow } from "./silences";
import type { InstanceValues } from "./values";
import type { InstanceValueSeries } from "./view";

const MINUTE = 60_000;
const NOW = new Date("2026-08-21T12:00:00Z");
const WINDOW = { from: new Date(NOW.getTime() - 60 * MINUTE), to: NOW };

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

function spec(overrides: Partial<AlertingRuleSpec> = {}): AlertingRuleSpec {
  return {
    sql: "SELECT 1",
    interval_secs: 60,
    for_secs: 300,
    label_columns: [],
    condition: { operator: "gt", threshold: 100 },
    severity: "warning",
    annotations: {},
    resolve_after: 1,
    ...overrides,
  };
}

function definition(
  overrides: Partial<DefinitionRow> & { slug: string },
): DefinitionRow {
  return {
    id: `id-${overrides.slug}`,
    organizationId: "org",
    repoid: "acme/repo",
    previewId: null,
    project: "demo",
    spec: spec(),
    version: 1,
    nextEvaluationAt: null,
    lastEnqueuedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    active: true,
    pausedAt: null,
    pausedByPrincipal: null,
    pausedBy: null,
    lastError: null,
    currentState: "unknown",
    consecutiveFailures: 0,
    degradedSince: null,
    lastErrorAt: null,
    lastFiredAt: null,
    lastResolvedAt: null,
    lastSeenAt: null,
    lastRowCount: 0,
    firingInstanceCount: 0,
    ...overrides,
  };
}

function instance(
  alertDefinitionId: string,
  overrides: Partial<InstanceRow> = {},
): InstanceRow {
  return {
    id: `${alertDefinitionId}-${overrides.fingerprint ?? "fp"}`,
    organizationId: "org",
    alertDefinitionId,
    fingerprint: "fp",
    status: "firing",
    labels: {},
    evidence: {},
    value: 120,
    pendingSince: null,
    activeSince: minutesAgo(12),
    lastSeenAt: NOW,
    absentCount: 0,
    episodeId: null,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A silence on the rule with this row id, whole-rule unless given more
 *  matchers. Definitions here are built with `id-${slug}`. */
function silence(
  ruleId: string,
  overrides: Partial<SilenceRow> = {},
): SilenceRow {
  return {
    id: `silence-${ruleId}`,
    organizationId: "org",
    startsAt: minutesAgo(5),
    endsAt: minutesAgo(-55),
    matchers: [{ label: "rule", op: "eq", value: ruleId }],
    comment: "",
    author: "",
    authorPrincipal: "",
    createdAt: NOW,
    canceledAt: null,
    ...overrides,
  };
}

function fact(overrides: Partial<NotificationFact> = {}): NotificationFact {
  return {
    eventType: "instance_fired",
    occurredAt: minutesAgo(3),
    processedAt: minutesAgo(3),
    suppressed: false,
    silenceId: null,
    title: "Latency high",
    grouped: true,
    flushed: true,
    ...overrides,
  };
}

const NO_VALUES: InstanceValues = { byPath: new Map(), bucketMs: MINUTE };

function lane(fingerprint: string): InstanceValueSeries {
  return {
    fingerprint,
    labels: `host=${fingerprint}`,
    points: [{ at: 1, value: 1, low: 1, high: 1, breaching: false }],
  };
}

function triage(overrides: Partial<TriageInput> = {}) {
  return assembleTriage({
    now: NOW,
    window: WINDOW,
    definitions: [],
    instances: [],
    silences: [],
    notifications: new Map(),
    held: new Map(),
    defaultTiers: new Set(["all"]),
    values: NO_VALUES,
    ...overrides,
  });
}

describe("assembleTriage", () => {
  it("orders the board by band, then severity, then silenced last, and keeps ties as given", () => {
    const definitions = [
      definition({ slug: "a", currentState: "firing" }),
      definition({
        slug: "b",
        currentState: "pending",
        spec: spec({ severity: "critical" }),
      }),
      definition({
        slug: "c",
        degradedSince: minutesAgo(2),
        spec: spec({ severity: "info" }),
      }),
      definition({
        slug: "d",
        currentState: "firing",
        spec: spec({ severity: "critical" }),
      }),
      definition({
        slug: "e",
        currentState: "firing",
        spec: spec({ severity: "critical" }),
      }),
      definition({ slug: "f", currentState: "resolved" }),
      definition({ slug: "g", active: false, currentState: "firing" }),
    ];
    const { alerts, rules } = triage({
      definitions,
      silences: [silence("id-d")],
    });

    expect(alerts.map((a) => a.path)).toEqual([
      "demo/c",
      "demo/e",
      "demo/d",
      "demo/a",
      "demo/b",
    ]);
    // Every rule is in the inventory, in the order it arrived, with the states
    // the board never shows.
    expect(rules.map((r) => [r.path, r.state])).toEqual([
      ["demo/a", "firing"],
      ["demo/b", "pending"],
      ["demo/c", "degraded"],
      ["demo/d", "silenced"],
      ["demo/e", "firing"],
      ["demo/f", "inactive"],
      ["demo/g", "paused"],
    ]);
  });

  it("dates each band by its own clock", () => {
    const degraded = definition({
      slug: "degraded",
      currentState: "firing",
      degradedSince: minutesAgo(7),
      consecutiveFailures: 3,
      lastError: "TIMEOUT",
    });
    const pending = definition({ slug: "pending", currentState: "pending" });
    const firing = definition({
      slug: "firing",
      currentState: "firing",
      lastRowCount: 2,
      lastFiredAt: minutesAgo(90),
    });
    const { alerts } = triage({
      definitions: [degraded, pending, firing],
      instances: [
        instance(pending.id, {
          status: "pending",
          pendingSince: minutesAgo(2),
          value: 101,
        }),
        instance(firing.id, {
          fingerprint: "worst",
          value: 120,
          activeSince: minutesAgo(12),
        }),
        instance(firing.id, {
          fingerprint: "quiet",
          status: "inactive",
          value: 50,
          activeSince: null,
        }),
      ],
    });
    const byPath = new Map(alerts.map((a) => [a.path, a]));

    // Degraded wins over the stale firing rollup, shows no value, and names
    // the failure.
    expect(byPath.get("demo/degraded")).toMatchObject({
      status: "degraded",
      since: "7m",
      value: null,
      error: "TIMEOUT",
      measured: "no rows · 3 consecutive failures",
      notification: `no verdict since the last attempt`,
    });
    // Pending counts from the instance's pending stamp, against `for`.
    expect(byPath.get("demo/pending")).toMatchObject({
      status: "pending",
      since: "2m",
      value: "101",
      pending: { total: "5m", percent: 40 },
      notification: "not notified · pending never delivers",
    });
    // Firing counts from the worst instance, not from the rule's own stamp,
    // and the worst instance is the breaching one however the values compare.
    expect(byPath.get("demo/firing")).toMatchObject({
      status: "firing",
      since: "12m",
      value: "120",
      condition: "value > 100",
      measured: "worst of 1 breaching · 2 rows",
      instances: 2,
    });
    expect(byPath.get("demo/firing")?.pending).toBeUndefined();
  });

  it("counts a pending instance as breaching, as the detail panel does", () => {
    const rule = definition({
      slug: "mixed",
      currentState: "firing",
      lastRowCount: 3,
    });
    const { alerts } = triage({
      definitions: [rule],
      instances: [
        instance(rule.id, { fingerprint: "hot", value: 120 }),
        instance(rule.id, {
          fingerprint: "warming",
          status: "pending",
          pendingSince: minutesAgo(1),
          value: 110,
        }),
        instance(rule.id, {
          fingerprint: "quiet",
          status: "inactive",
          value: 10,
          activeSince: null,
        }),
      ],
    });

    expect(alerts[0]).toMatchObject({
      measured: "worst of 2 breaching · 3 rows",
    });
  });

  it("attributes a rule to the whole-rule silence over an instance-scoped one", () => {
    const rule = definition({ slug: "latency", currentState: "firing" });
    const partial = silence("id-latency", {
      id: "partial",
      startsAt: minutesAgo(10),
      matchers: [
        { label: "rule", op: "eq", value: "id-latency" },
        { label: "host", op: "eq", value: "a" },
      ],
    });
    const whole = silence("id-latency", { id: "whole" });
    const paused = definition({ slug: "paused", active: false });
    const { alerts, rules } = triage({
      definitions: [rule, paused],
      silences: [partial, whole, silence("id-paused")],
      held: new Map([[rule.id, 2]]),
    });

    expect(alerts[0]).toMatchObject({
      status: "firing",
      silence: {
        id: "whole",
        wholeRule: true,
        expiresIn: "55m",
        suppressed: 2,
      },
      notification: "2 notifications held · none sent",
    });
    expect(rules[0]).toMatchObject({ state: "silenced", silence: "55m left" });
    // A paused rule is off, not muted: no silence to report, whatever exists.
    expect(rules[1]).toMatchObject({ state: "paused", silence: null });
  });

  it("reads the delivery story from the journal, not from the rule's state", () => {
    const cases: [string, Partial<NotificationFact> | null, string][] = [
      ["flushed", {}, "notified · Latency high · 3m ago"],
      [
        "resolved",
        { eventType: "instance_resolved", title: "" },
        "resolved · 3m ago",
      ],
      ["queued", { flushed: false }, "queued · 3m ago"],
      ["unprocessed", { processedAt: null }, "queued · 3m ago"],
      ["suppressed", { suppressed: true }, "notification suppressed · 3m ago"],
      [
        "terminal",
        { grouped: false, flushed: false },
        "not sent · stopped firing first · 3m ago",
      ],
      ["silent", null, "nothing sent yet"],
    ];
    const definitions = cases.map(([slug]) =>
      definition({ slug, currentState: "firing" }),
    );
    const { alerts } = triage({
      definitions,
      notifications: new Map(
        cases.flatMap(([slug, overrides]) =>
          overrides ? [[`id-${slug}`, fact(overrides)] as const] : [],
        ),
      ),
    });
    const byPath = new Map(alerts.map((a) => [a.path, a.notification]));
    for (const [slug, , text] of cases) {
      expect(byPath.get(`demo/${slug}`), slug).toBe(text);
    }
  });

  it("says when nothing at all could have carried the notification", () => {
    const rule = definition({ slug: "orphan", currentState: "firing" });
    const { alerts } = triage({
      definitions: [rule],
      defaultTiers: new Set(),
      notifications: new Map([
        [rule.id, fact({ grouped: false, flushed: false })],
      ]),
    });
    expect(alerts[0].notification).toBe("not sent · no channel for this rule");
  });

  it("hands each row the lanes the charts read, on the window the server read them for", () => {
    const rule = definition({ slug: "latency", currentState: "firing" });
    const quiet = definition({ slug: "quiet", currentState: "pending" });
    const { alerts } = triage({
      definitions: [rule, quiet],
      values: {
        byPath: new Map([["demo/latency", { lanes: [lane("a")], hidden: 0 }]]),
        bucketMs: MINUTE,
      },
    });
    expect(alerts[0].spark).toEqual({
      instances: [lane("a")],
      window: { minutes: 60, endsAt: NOW.getTime() },
    });
    expect(alerts[1].spark.instances).toEqual([]);
  });
});

describe("assembleRuleStateHistory", () => {
  function history(overrides: Partial<RuleStateHistoryInput> = {}) {
    return assembleRuleStateHistory({
      now: NOW,
      window: WINDOW,
      definitions: [],
      silences: [],
      events: [],
      prior: [],
      values: NO_VALUES,
      ...overrides,
    });
  }

  it("keys each rule's segments by path, carries prior state in, and drops a stamp that will not parse", () => {
    const a = definition({ slug: "a", currentState: "firing" });
    const b = definition({ slug: "b", currentState: "firing" });
    const out = history({
      definitions: [a, b],
      silences: [silence("id-a", { startsAt: minutesAgo(20) })],
      events: [
        {
          slug: "demo/a",
          instance_fingerprint: "x",
          event_type: "instance_fired",
          event_time: "2026-08-21 11:30:00",
        },
        {
          slug: "demo/a",
          instance_fingerprint: "x",
          event_type: "instance_resolved",
          event_time: "2026-08-21 11:50:00",
        },
        {
          slug: "demo/a",
          instance_fingerprint: "y",
          event_type: "instance_fired",
          event_time: "not a time",
        },
      ],
      prior: [
        {
          slug: "demo/b",
          instance_fingerprint: "z",
          last_event_type: "instance_fired",
        },
      ],
      values: {
        byPath: new Map([["demo/b", { lanes: [lane("z")], hidden: 0 }]]),
        bucketMs: MINUTE,
      },
    });

    expect(out.window).toEqual({ minutes: 60, endsAt: NOW.getTime() });
    // The fire splits where the silence took hold; the unparsable row would
    // otherwise have painted `y` firing across the whole window.
    expect(out.rules["demo/a"]).toEqual({
      instances: [],
      segments: [
        { state: "firing", from: 30, to: 20 },
        { state: "silenced", from: 20, to: 10 },
      ],
    });
    // Nothing happened inside the window; the state it was left in still
    // shows.
    expect(out.rules["demo/b"]).toEqual({
      instances: [lane("z")],
      segments: [{ state: "firing", from: 60, to: 0 }],
    });
  });
});

describe("assembleAlertDetail", () => {
  function detail(overrides: Partial<AlertDetailInput> = {}) {
    return assembleAlertDetail({
      now: NOW,
      window: WINDOW,
      definition: definition({ slug: "latency", currentState: "firing" }),
      instances: [],
      silences: [],
      windowSilences: [],
      silenceImpacts: new Map(),
      notifications: new Map(),
      held: new Map(),
      defaultTiers: new Set(["all"]),
      timeline: [],
      lastSamples: [],
      values: NO_VALUES,
      ...overrides,
    });
  }

  it("counts a silenced rule's clock from the silence and says evaluation goes on", () => {
    const rule = definition({ slug: "latency", currentState: "firing" });
    const partial = silence("id-latency", {
      id: "partial",
      startsAt: minutesAgo(30),
      matchers: [
        { label: "rule", op: "eq", value: "id-latency" },
        { label: "host", op: "eq", value: "a" },
      ],
    });
    const whole = silence("id-latency", { id: "whole" });
    const out = detail({
      definition: rule,
      instances: [instance(rule.id, { activeSince: minutesAgo(40) })],
      silences: [partial, whole],
      windowSilences: [whole, partial],
    });

    expect(out).toMatchObject({
      status: "silenced",
      since: "5m",
      notification: "nothing will be sent · rule keeps evaluating",
      activeSilenceId: "whole",
    });
  });

  it("reports a paused rule as off, with no clock and nothing evaluating", () => {
    const out = detail({
      definition: definition({
        slug: "latency",
        active: false,
        currentState: "firing",
      }),
    });
    expect(out).toMatchObject({ status: "paused", since: null });
  });

  it("names how long a pause has run and who started it", () => {
    const out = detail({
      definition: definition({
        slug: "latency",
        active: false,
        pausedAt: minutesAgo(14),
        pausedByPrincipal: "user:u1",
        pausedBy: "Ada",
      }),
    });
    expect(out.notification).toBe("since 14m by Ada");
  });

  it("says nothing when the pause trail predates the columns", () => {
    const out = detail({
      definition: definition({
        slug: "latency",
        active: false,
        pausedAt: null,
        pausedBy: null,
      }),
    });
    expect(out.notification).toBe("");
  });

  it("dates a firing rule from its worst instance and reads delivery from the journal", () => {
    const rule = definition({ slug: "latency", currentState: "firing" });
    const out = detail({
      definition: rule,
      instances: [instance(rule.id, { activeSince: minutesAgo(40) })],
      notifications: new Map([[rule.id, fact()]]),
    });
    expect(out).toMatchObject({
      status: "firing",
      since: "40m",
      notification: "notified · Latency high · 3m ago",
      activeSilenceId: null,
    });
  });

  it("lists every silence that overlapped the window with its state and what it withheld", () => {
    const scoped = [
      { label: "rule", op: "eq", value: "id-latency" },
      { label: "host", op: "ne", value: "a" },
    ] as const;
    const out = detail({
      windowSilences: [
        silence("id-latency", { id: "active", matchers: [...scoped] }),
        silence("id-latency", {
          id: "scheduled",
          startsAt: minutesAgo(-10),
          endsAt: minutesAgo(-70),
        }),
        silence("id-latency", {
          id: "expired",
          startsAt: minutesAgo(120),
          endsAt: minutesAgo(60),
        }),
        silence("id-latency", {
          id: "cancelled",
          startsAt: minutesAgo(50),
          endsAt: minutesAgo(45),
          canceledAt: minutesAgo(45),
          comment: "false positive",
          author: "guido",
        }),
      ],
      silenceImpacts: new Map([["active", { held: 3, dropped: 1 }]]),
    });

    expect(out.silences.map((s) => [s.id, s.state])).toEqual([
      ["active", "active"],
      ["scheduled", "scheduled"],
      ["expired", "expired"],
      ["cancelled", "cancelled"],
    ]);
    expect(out.silences[0]).toMatchObject({
      scope: "host!=a",
      impact: "held 3 · dropped 1",
    });
    expect(out.silences[3]).toMatchObject({
      scope: "",
      impact: null,
      canceledAt: minutesAgo(45).toISOString(),
      comment: "false positive",
      author: "guido",
    });
  });

  it("keeps the timeline in the engine's words and marks the newest row current", () => {
    const out = detail({
      timeline: [
        {
          event_type: "instance_fired",
          event_time: "2026-08-21 11:50:00",
          instance_labels: { host: "a" },
          reason: "",
          silenced: false,
          error: "",
        },
        {
          event_type: "evaluation_failed",
          event_time: "not a time",
          instance_labels: {},
          reason: "",
          silenced: true,
          error: "TIMEOUT",
        },
      ],
    });
    expect(out.timeline).toEqual([
      {
        time: formatClock(new Date("2026-08-21T11:50:00Z")),
        text: "instance_fired · a",
        current: true,
      },
      { time: null, text: "evaluation_failed · held by silence · TIMEOUT" },
    ]);
  });

  it("describes the rule as written and counts every series the last evaluation saw", () => {
    const rule = definition({
      slug: "latency",
      currentState: "firing",
      lastSeenAt: minutesAgo(1),
      spec: spec({
        interval_secs: 120,
        for_secs: 600,
        sql: "SELECT p99 AS value FROM spans",
        annotations: {
          "link.runbook": "https://everr.dev/runbooks/demo/latency-runbook",
          summary: "p99 over threshold",
        },
      }),
    });
    const out = detail({
      definition: rule,
      instances: [
        instance(rule.id, { fingerprint: "a" }),
        instance(rule.id, { fingerprint: "b", status: "pending" }),
        instance(rule.id, { fingerprint: "c", status: "inactive" }),
      ],
      lastSamples: [{ fingerprint: "d", labels: {}, value: 1 }],
      values: {
        byPath: new Map([
          ["demo/latency", { lanes: [lane("a"), lane("b")], hidden: 4 }],
        ]),
        bucketMs: 5 * MINUTE,
      },
    });

    expect(out).toMatchObject({
      description: "This rule declares no description.",
      instanceSummary: "2 of 4 breaching",
      instanceValues: [lane("a"), lane("b")],
      hiddenInstanceValues: 4,
      bucketMinutes: 5,
      intervalMinutes: 2,
      forClause: "10m",
      threshold: 100,
      window: { minutes: 60, endsAt: NOW.getTime() },
      definition: {
        repository: "acme/repo",
        project: "demo",
        runbook: {
          href: "https://everr.dev/runbooks/demo/latency-runbook",
          label: "latency-runbook",
        },
        evaluationInterval: "2m",
        notificationTitle: "p99 over threshold",
        notificationDescription: "",
        lastEvaluatedAt: minutesAgo(1).toISOString(),
        query: "SELECT p99 AS value FROM spans",
      },
    });
  });
});
