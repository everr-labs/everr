import { describe, expect, it } from "vitest";
import type {
  CcAlert,
  CcRoute,
  CcRuleView,
  CcSilence,
  CcSlo,
} from "@/data/cc/types";
import {
  ccGroupInstances,
  ccResolveTriageInstances,
  ccSourceScopedSilenceMatchers,
  ccTriageCounts,
} from "./triage";

const SLO_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-07-30T12:00:00Z");

function ccRule(overrides: Partial<CcRuleView> = {}): CcRuleView {
  return {
    id: "rule-1",
    tenant: "org1",
    namespace: "",
    name: "default/flapping",
    spec: {
      sql: "SELECT 1",
      interval_secs: 30,
      for_secs: 0,
      label_columns: ["host"],
      value_column: null,
      severity: "critical",
      annotations: { "everr.display.name": "Flapping check" },
      resolve_after: 1,
      suppressed: false,
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
    ...overrides,
  };
}

function ccAlert(overrides: Partial<CcAlert> = {}): CcAlert {
  return {
    key: "fp-1",
    rule: "rule-1",
    tenant: "org1",
    status: "firing",
    labels: { host: "web-1" },
    value: 42,
    active_since: "2026-07-30T11:55:00Z",
    last_seen: "2026-07-30T12:00:00Z",
    absent_count: 0,
    ...overrides,
  };
}

function ccSlo(overrides: Partial<CcSlo> = {}): CcSlo {
  return {
    id: SLO_ID,
    tenant: "org1",
    namespace: "",
    name: "default/checkout-availability",
    spec: {
      sli: { sql: "SELECT 1 AS good, 1 AS valid", label_columns: ["service"] },
      targetPercent: 99.9,
      timeWindow: { duration: "30d", isRolling: true },
      annotations: {},
      suppressed: false,
    },
    version: 1,
    paused: false,
    ...overrides,
  };
}

function ccRoute(overrides: Partial<CcRoute> = {}): CcRoute {
  return {
    id: "route-1",
    tenant: "org1",
    matchers: [{ label: "host", op: "eq", value: "web-1" }],
    receiver: "oncall",
    continue: false,
    priority: 1,
    group_by: null,
    group_wait_secs: null,
    group_interval_secs: null,
    repeat_interval_secs: null,
    ...overrides,
  };
}

function ccSilence(overrides: Partial<CcSilence> = {}): CcSilence {
  return {
    id: "sil-1",
    tenant: "org1",
    matchers: [{ label: "svc", op: "eq", value: "api" }],
    starts_at: new Date(NOW - 3_600_000).toISOString(),
    ends_at: new Date(NOW + 3_600_000).toISOString(),
    comment: "maintenance",
    author: null,
    created_at: new Date(NOW - 3_600_000).toISOString(),
    ...overrides,
  };
}

function resolve(input: {
  alerts: CcAlert[];
  rules?: CcRuleView[];
  slos?: CcSlo[];
  routes?: CcRoute[];
  silences?: CcSilence[];
}) {
  return ccResolveTriageInstances({
    alerts: input.alerts,
    rules: input.rules ?? [ccRule()],
    slos: input.slos ?? [],
    routes: input.routes ?? [ccRoute()],
    silences: input.silences ?? [],
    now: NOW,
  });
}

describe("ccResolveTriageInstances", () => {
  it("resolves a rule-sourced instance to its rule, routes, and silence", () => {
    const [inst] = resolve({ alerts: [ccAlert()] });
    expect(inst.rule?.id).toBe("rule-1");
    expect(inst.slo).toBeUndefined();
    expect(inst.matchedRoutes.map((r) => r.receiver)).toEqual(["oncall"]);
    expect(inst.silence).toBeNull();
  });

  it("resolves an SLO-sourced instance to its SLO, never to a rule", () => {
    // CC's wire convention puts the source uuid in `alert.rule` for SLO rows
    // too; `alert.slo` is what discriminates.
    const [inst] = resolve({
      alerts: [ccAlert({ rule: SLO_ID, slo: SLO_ID, labels: {} })],
      slos: [ccSlo()],
    });
    expect(inst.slo?.id).toBe(SLO_ID);
    expect(inst.rule).toBeUndefined();
  });

  it("attaches a matching active silence", () => {
    const [inst] = resolve({
      alerts: [ccAlert({ labels: { svc: "api" } })],
      silences: [ccSilence()],
    });
    expect(inst.silence?.id).toBe("sil-1");
  });
});

describe("ccTriageCounts", () => {
  it("counts every pipeline number in one pass", () => {
    const instances = resolve({
      alerts: [
        ccAlert(),
        ccAlert({ key: "fp-2", status: "pending", labels: { host: "web-2" } }),
        ccAlert({ key: "fp-3", labels: { svc: "api" } }),
        ccAlert({ key: "fp-4", status: "inactive", labels: { host: "web-9" } }),
      ],
      silences: [ccSilence()],
    });

    // fp-1 and fp-3 are firing; fp-2 is pending and fp-4 inactive. Only fp-3
    // (svc=api) is matched by the silence, and `silenced` ignores inactive
    // rows. The single route matches host=web-1, so fp-3 is firing-unrouted —
    // but it is silenced, so it does not count as unrouted either.
    expect(
      ccTriageCounts(ccGroupInstances(instances), [ccSilence()], NOW),
    ).toEqual({
      firing: 2,
      pending: 1,
      silenced: 1,
      unroutedFiring: 0,
      activeSilences: 1,
    });
  });

  it("counts a firing instance that matches no route and no silence", () => {
    const instances = resolve({
      alerts: [ccAlert({ labels: { host: "nowhere" } })],
    });
    expect(ccTriageCounts(ccGroupInstances(instances), [], NOW)).toMatchObject({
      firing: 1,
      unroutedFiring: 1,
    });
  });

  // The strip and the board are one tally: an SLO tripping two tiers is one
  // firing thing in both, not two in the strip and one on the board.
  it("counts a two-tier SLO row once", () => {
    const tier = (slo_tier: string, key: string) =>
      ccAlert({
        key,
        rule: SLO_ID,
        slo: SLO_ID,
        labels: { service: "checkout", slo_tier },
      });
    const instances = resolve({
      alerts: [tier("fast-burn", "fp-fast"), tier("ticket", "fp-ticket")],
      slos: [ccSlo()],
    });

    expect(ccTriageCounts(ccGroupInstances(instances), [], NOW)).toMatchObject({
      firing: 1,
      unroutedFiring: 1,
    });
  });

  it("does not count an expired silence as active", () => {
    const expired = ccSilence({
      starts_at: new Date(NOW - 7_200_000).toISOString(),
      ends_at: new Date(NOW - 3_600_000).toISOString(),
    });
    expect(ccTriageCounts([], [expired], NOW).activeSilences).toBe(0);
  });
});

describe("ccGroupInstances", () => {
  // The board is unfiltered: silenced and inactive instances stay on it
  // alongside the firing ones, so grouping must not drop either.
  it("keeps silenced and inactive instances on the board", () => {
    const [group] = ccGroupInstances(
      resolve({
        alerts: [
          ccAlert(),
          ccAlert({ key: "fp-3", labels: { svc: "api" } }),
          ccAlert({
            key: "fp-4",
            status: "inactive",
            labels: { host: "web-9" },
          }),
        ],
        silences: [ccSilence()],
      }),
    );

    expect(group.rows.map((r) => r.lead.alert.key)).toEqual([
      "fp-1",
      "fp-3",
      "fp-4",
    ]);
    expect(group.rows[1].lead.silence?.id).toBe("sil-1");
  });

  // An SLO's tiers are three sensitivities on one budget, so a label set
  // tripping two of them is one problem, not two rows.
  it("collapses an SLO's burn-rate tiers into one row per label set", () => {
    const sloInstance = (tier: string, key: string, value: number) =>
      ccAlert({
        key,
        rule: SLO_ID,
        slo: SLO_ID,
        labels: { service: "checkout", slo_tier: tier },
        value,
      });
    const [group] = ccGroupInstances(
      resolve({
        alerts: [
          sloInstance("ticket", "fp-ticket", 176.7),
          sloInstance("fast-burn", "fp-fast", 192.2),
          // A second label set stays its own row: that is a second problem.
          ccAlert({
            key: "fp-other",
            rule: SLO_ID,
            slo: SLO_ID,
            labels: { service: "payments", slo_tier: "ticket" },
          }),
        ],
        slos: [ccSlo()],
      }),
    );

    expect(group.rows).toHaveLength(2);
    const checkout = group.rows.find(
      (r) => r.lead.alert.labels.service === "checkout",
    );
    // Canonical tier order is urgency order, so fast-burn leads and the row's
    // value is its burn rate, not the ticket tier's.
    expect(checkout?.lead.alert.key).toBe("fp-fast");
    expect(checkout?.lead.alert.value).toBe(192.2);
    expect(checkout?.tiers).toEqual(["fast-burn", "ticket"]);
    expect(checkout?.members).toHaveLength(2);
  });

  it("keeps a rule's instances one row each: each is its own label set", () => {
    const [group] = ccGroupInstances(
      resolve({
        alerts: [
          ccAlert(),
          ccAlert({ key: "fp-2", labels: { host: "web-2" } }),
        ],
      }),
    );

    expect(group.rows).toHaveLength(2);
    expect(group.rows.every((r) => r.members.length === 1)).toBe(true);
    expect(group.rows.every((r) => r.tiers.length === 0)).toBe(true);
  });

  it("counts only firing tiers, so a resolved tier leaves no badge", () => {
    const [group] = ccGroupInstances(
      resolve({
        alerts: [
          ccAlert({
            key: "fp-fast",
            rule: SLO_ID,
            slo: SLO_ID,
            labels: { service: "checkout", slo_tier: "fast-burn" },
          }),
          ccAlert({
            key: "fp-ticket",
            rule: SLO_ID,
            slo: SLO_ID,
            status: "inactive",
            labels: { service: "checkout", slo_tier: "ticket" },
          }),
        ],
        slos: [ccSlo()],
      }),
    );

    expect(group.rows).toHaveLength(1);
    expect(group.rows[0].tiers).toEqual(["fast-burn"]);
    expect(group.rows[0].members).toHaveLength(2);
  });

  it("groups by source and sorts critical before warning", () => {
    const warningRule = ccRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: { ...ccRule().spec, severity: "warning", annotations: {} },
    });
    const instances = resolve({
      alerts: [
        ccAlert({ key: "fp-3", rule: "rule-2", labels: { svc: "api" } }),
        ccAlert(),
      ],
      rules: [ccRule(), warningRule],
    });

    const groups = ccGroupInstances(instances);
    expect(groups.map((g) => g.name)).toEqual(["Flapping check", "api-errors"]);
    expect(groups[0].severity).toBe("critical");
  });

  it("floats a firing group above a higher-severity one that has stopped", () => {
    const warningRule = ccRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: { ...ccRule().spec, severity: "warning", annotations: {} },
    });
    const instances = resolve({
      // The critical rule's instance is over; the warning rule's is firing.
      alerts: [
        ccAlert({ status: "inactive" }),
        ccAlert({ key: "fp-3", rule: "rule-2", labels: { svc: "api" } }),
      ],
      rules: [ccRule(), warningRule],
    });

    const groups = ccGroupInstances(instances);
    expect(groups.map((g) => g.name)).toEqual(["api-errors", "Flapping check"]);
    expect(groups[0].severity).toBe("warning");
  });

  it("puts a pending group above an inactive one", () => {
    const otherRule = ccRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: { ...ccRule().spec, annotations: {} },
    });
    const instances = resolve({
      alerts: [
        ccAlert({ status: "inactive" }),
        ccAlert({ key: "fp-3", rule: "rule-2", status: "pending" }),
      ],
      rules: [ccRule(), otherRule],
    });

    expect(ccGroupInstances(instances).map((g) => g.name)).toEqual([
      "api-errors",
      "Flapping check",
    ]);
  });

  it("sorts firing before pending within a group", () => {
    const instances = resolve({
      alerts: [
        ccAlert({ key: "fp-2", status: "pending", labels: { host: "web-2" } }),
        ccAlert(),
      ],
    });
    const [group] = ccGroupInstances(instances);
    expect(group.rows.map((r) => r.lead.alert.status)).toEqual([
      "firing",
      "pending",
    ]);
  });

  it("falls back to a short source id when the rule listing has not caught up", () => {
    const instances = resolve({
      alerts: [ccAlert({ rule: "unknown-rule-id" })],
      rules: [],
    });
    const [group] = ccGroupInstances(instances);
    expect(group.name).toBe("unknown-".slice(0, 8));
    expect(group.rule).toBeUndefined();
  });

  // Severity comes off the instance's own slo_tier label, so it must not wait
  // on the SLO listing. It used to: an unresolved SLO group took the rule-side
  // "info" default despite having no rule, and sorted to the bottom.
  it("reads an SLO group's severity before the SLO listing has caught up", () => {
    const alerts = [
      ccAlert({
        key: "fp-fast",
        rule: SLO_ID,
        slo: SLO_ID,
        labels: { service: "checkout", slo_tier: "fast-burn" },
      }),
    ];
    const [resolved] = ccGroupInstances(resolve({ alerts, slos: [ccSlo()] }));
    const [unresolved] = ccGroupInstances(resolve({ alerts, slos: [] }));

    expect(resolved.severity).toBe("critical");
    expect(unresolved.severity).toBe("critical");
    // The name still degrades to the short uuid, as it must: that one really
    // does need the listing.
    expect(unresolved.name).toBe(SLO_ID.slice(0, 8));
  });

  it("still collapses tiers when the SLO listing has not caught up", () => {
    const tier = (slo_tier: string, key: string) =>
      ccAlert({
        key,
        rule: SLO_ID,
        slo: SLO_ID,
        labels: { service: "checkout", slo_tier },
      });
    const [group] = ccGroupInstances(
      resolve({
        alerts: [tier("fast-burn", "fp-fast"), tier("ticket", "fp-ticket")],
        slos: [],
      }),
    );

    expect(group.rows).toHaveLength(1);
    expect(group.rows[0].tiers).toEqual(["fast-burn", "ticket"]);
  });
});

describe("ccSourceScopedSilenceMatchers", () => {
  it("pins every label plus a synthetic rule matcher", () => {
    expect(ccSourceScopedSilenceMatchers(ccAlert())).toEqual([
      { label: "host", op: "eq", value: "web-1" },
      { label: "rule", op: "eq", value: "rule-1" },
    ]);
  });

  it("scopes an SLO-sourced instance by slo, not rule, and never by tier", () => {
    const alert = ccAlert({
      rule: SLO_ID,
      slo: SLO_ID,
      labels: { service: "checkout", slo_tier: "fast-burn" },
    });
    // The board shows this label set as one row across every tier, so muting
    // it must mute every tier: pinning slo_tier would leave the same problem
    // paging from the next tier down.
    expect(ccSourceScopedSilenceMatchers(alert)).toEqual([
      { label: "service", op: "eq", value: "checkout" },
      { label: "slo", op: "eq", value: SLO_ID },
    ]);
  });
});
