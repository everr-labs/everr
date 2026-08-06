import { describe, expect, it } from "vitest";
import type {
  AlertingAlert,
  AlertingRoute,
  AlertingRuleView,
  AlertingSilence,
  AlertingSlo,
} from "@/data/alerting/types";
import { alertingRuleViewFixture } from "./test-fixtures";
import {
  alertingGroupInstances,
  alertingResolveTriageInstances,
  alertingSourceScopedSilenceMatchers,
  alertingTriageCounts,
} from "./triage";

const SLO_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-07-30T12:00:00Z");

function alertingRule(
  overrides: Partial<AlertingRuleView> = {},
): AlertingRuleView {
  return alertingRuleViewFixture({
    id: "rule-1",
    spec: {
      interval_secs: 30,
      label_columns: ["host"],
      value_column: null,
      annotations: { "everr.display.name": "Flapping check" },
    },
    ...overrides,
  });
}

function alertingAlert(overrides: Partial<AlertingAlert> = {}): AlertingAlert {
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

function alertingSlo(overrides: Partial<AlertingSlo> = {}): AlertingSlo {
  return {
    id: SLO_ID,
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
    version: 1,
    paused: false,
    ...overrides,
  };
}

function alertingRoute(overrides: Partial<AlertingRoute> = {}): AlertingRoute {
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

function alertingSilence(
  overrides: Partial<AlertingSilence> = {},
): AlertingSilence {
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
  alerts: AlertingAlert[];
  rules?: AlertingRuleView[];
  slos?: AlertingSlo[];
  routes?: AlertingRoute[];
  silences?: AlertingSilence[];
}) {
  return alertingResolveTriageInstances({
    alerts: input.alerts,
    rules: input.rules ?? [alertingRule()],
    slos: input.slos ?? [],
    routes: input.routes ?? [alertingRoute()],
    silences: input.silences ?? [],
    now: NOW,
  });
}

describe("alertingResolveTriageInstances", () => {
  it("resolves a rule-sourced instance to its rule, routes, and silence", () => {
    const [inst] = resolve({ alerts: [alertingAlert()] });
    expect(inst.rule?.id).toBe("rule-1");
    expect(inst.slo).toBeUndefined();
    expect(inst.matchedRoutes.map((r) => r.receiver)).toEqual(["oncall"]);
    expect(inst.silence).toBeNull();
  });

  it("resolves an SLO-sourced instance to its SLO, never to a rule", () => {
    // alerting engine's wire convention puts the source uuid in `alert.rule` for SLO rows
    // too; `alert.slo` is what discriminates.
    const [inst] = resolve({
      alerts: [alertingAlert({ rule: SLO_ID, slo: SLO_ID, labels: {} })],
      slos: [alertingSlo()],
    });
    expect(inst.slo?.id).toBe(SLO_ID);
    expect(inst.rule).toBeUndefined();
  });

  it("attaches a matching active silence", () => {
    const [inst] = resolve({
      alerts: [alertingAlert({ labels: { svc: "api" } })],
      silences: [alertingSilence()],
    });
    expect(inst.silence?.id).toBe("sil-1");
  });
});

describe("alertingTriageCounts", () => {
  it("counts every pipeline number in one pass", () => {
    const instances = resolve({
      alerts: [
        alertingAlert(),
        alertingAlert({
          key: "fp-2",
          status: "pending",
          labels: { host: "web-2" },
        }),
        alertingAlert({ key: "fp-3", labels: { svc: "api" } }),
        alertingAlert({
          key: "fp-4",
          status: "inactive",
          labels: { host: "web-9" },
        }),
      ],
      silences: [alertingSilence()],
    });

    // fp-1 and fp-3 are firing; fp-2 is pending and fp-4 inactive. Only fp-3
    // (svc=api) is matched by the silence, and `silenced` ignores inactive
    // rows. The single route matches host=web-1, so fp-3 is firing-unrouted —
    // but it is silenced, so it does not count as unrouted either.
    expect(
      alertingTriageCounts(
        alertingGroupInstances(instances),
        [alertingSilence()],
        NOW,
      ),
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
      alerts: [alertingAlert({ labels: { host: "nowhere" } })],
    });
    expect(
      alertingTriageCounts(alertingGroupInstances(instances), [], NOW),
    ).toMatchObject({
      firing: 1,
      unroutedFiring: 1,
    });
  });

  // The strip and the board are one tally: an SLO tripping two tiers is one
  // firing thing in both, not two in the strip and one on the board.
  it("counts a two-tier SLO row once", () => {
    const tier = (slo_tier: string, key: string) =>
      alertingAlert({
        key,
        rule: SLO_ID,
        slo: SLO_ID,
        labels: { slo_tier },
      });
    const instances = resolve({
      alerts: [tier("fast-burn", "fp-fast"), tier("ticket", "fp-ticket")],
      slos: [alertingSlo()],
    });

    expect(
      alertingTriageCounts(alertingGroupInstances(instances), [], NOW),
    ).toMatchObject({
      firing: 1,
      unroutedFiring: 1,
    });
  });

  it("does not count an expired silence as active", () => {
    const expired = alertingSilence({
      starts_at: new Date(NOW - 7_200_000).toISOString(),
      ends_at: new Date(NOW - 3_600_000).toISOString(),
    });
    expect(alertingTriageCounts([], [expired], NOW).activeSilences).toBe(0);
  });
});

describe("alertingGroupInstances", () => {
  // The board is unfiltered: silenced and inactive instances stay on it
  // alongside the firing ones, so grouping must not drop either.
  it("keeps silenced and inactive instances on the board", () => {
    const [group] = alertingGroupInstances(
      resolve({
        alerts: [
          alertingAlert(),
          alertingAlert({ key: "fp-3", labels: { svc: "api" } }),
          alertingAlert({
            key: "fp-4",
            status: "inactive",
            labels: { host: "web-9" },
          }),
        ],
        silences: [alertingSilence()],
      }),
    );

    expect(group.rows.map((r) => r.lead.alert.key)).toEqual([
      "fp-1",
      "fp-3",
      "fp-4",
    ]);
    expect(group.rows[1].lead.silence?.id).toBe("sil-1");
  });

  // An SLO's tiers are three sensitivities on one budget, so tripping two of
  // them is one problem, not two rows.
  it("collapses an SLO's burn-rate tiers into one row", () => {
    const sloInstance = (tier: string, key: string, value: number) =>
      alertingAlert({
        key,
        rule: SLO_ID,
        slo: SLO_ID,
        labels: { slo_tier: tier },
        value,
      });
    const [group] = alertingGroupInstances(
      resolve({
        alerts: [
          sloInstance("ticket", "fp-ticket", 176.7),
          sloInstance("fast-burn", "fp-fast", 192.2),
        ],
        slos: [alertingSlo()],
      }),
    );

    expect(group.rows).toHaveLength(1);
    const [row] = group.rows;
    // Canonical tier order is urgency order, so fast-burn leads and the row's
    // value is its burn rate, not the ticket tier's.
    expect(row.lead.alert.key).toBe("fp-fast");
    expect(row.lead.alert.value).toBe(192.2);
    expect(row.tiers).toEqual(["fast-burn", "ticket"]);
    expect(row.members).toHaveLength(2);
  });

  it("keeps a rule's instances one row each: each is its own label set", () => {
    const [group] = alertingGroupInstances(
      resolve({
        alerts: [
          alertingAlert(),
          alertingAlert({ key: "fp-2", labels: { host: "web-2" } }),
        ],
      }),
    );

    expect(group.rows).toHaveLength(2);
    expect(group.rows.every((r) => r.members.length === 1)).toBe(true);
    expect(group.rows.every((r) => r.tiers.length === 0)).toBe(true);
  });

  it("counts only firing tiers, so a resolved tier leaves no badge", () => {
    const [group] = alertingGroupInstances(
      resolve({
        alerts: [
          alertingAlert({
            key: "fp-fast",
            rule: SLO_ID,
            slo: SLO_ID,
            labels: { slo_tier: "fast-burn" },
          }),
          alertingAlert({
            key: "fp-ticket",
            rule: SLO_ID,
            slo: SLO_ID,
            status: "inactive",
            labels: { slo_tier: "ticket" },
          }),
        ],
        slos: [alertingSlo()],
      }),
    );

    expect(group.rows).toHaveLength(1);
    expect(group.rows[0].tiers).toEqual(["fast-burn"]);
    expect(group.rows[0].members).toHaveLength(2);
  });

  it("groups by source and sorts critical before warning", () => {
    const warningRule = alertingRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: { ...alertingRule().spec, severity: "warning", annotations: {} },
    });
    const instances = resolve({
      alerts: [
        alertingAlert({ key: "fp-3", rule: "rule-2", labels: { svc: "api" } }),
        alertingAlert(),
      ],
      rules: [alertingRule(), warningRule],
    });

    const groups = alertingGroupInstances(instances);
    expect(groups.map((g) => g.name)).toEqual(["Flapping check", "api-errors"]);
    expect(groups[0].severity).toBe("critical");
  });

  it("floats a firing group above a higher-severity one that has stopped", () => {
    const warningRule = alertingRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: { ...alertingRule().spec, severity: "warning", annotations: {} },
    });
    const instances = resolve({
      // The critical rule's instance is over; the warning rule's is firing.
      alerts: [
        alertingAlert({ status: "inactive" }),
        alertingAlert({ key: "fp-3", rule: "rule-2", labels: { svc: "api" } }),
      ],
      rules: [alertingRule(), warningRule],
    });

    const groups = alertingGroupInstances(instances);
    expect(groups.map((g) => g.name)).toEqual(["api-errors", "Flapping check"]);
    expect(groups[0].severity).toBe("warning");
  });

  it("puts a pending group above an inactive one", () => {
    const otherRule = alertingRule({
      id: "rule-2",
      name: "default/api-errors",
      spec: { ...alertingRule().spec, annotations: {} },
    });
    const instances = resolve({
      alerts: [
        alertingAlert({ status: "inactive" }),
        alertingAlert({ key: "fp-3", rule: "rule-2", status: "pending" }),
      ],
      rules: [alertingRule(), otherRule],
    });

    expect(alertingGroupInstances(instances).map((g) => g.name)).toEqual([
      "api-errors",
      "Flapping check",
    ]);
  });

  it("sorts firing before pending within a group", () => {
    const instances = resolve({
      alerts: [
        alertingAlert({
          key: "fp-2",
          status: "pending",
          labels: { host: "web-2" },
        }),
        alertingAlert(),
      ],
    });
    const [group] = alertingGroupInstances(instances);
    expect(group.rows.map((r) => r.lead.alert.status)).toEqual([
      "firing",
      "pending",
    ]);
  });

  it("falls back to a short source id when the rule listing has not caught up", () => {
    const instances = resolve({
      alerts: [alertingAlert({ rule: "unknown-rule-id" })],
      rules: [],
    });
    const [group] = alertingGroupInstances(instances);
    expect(group.name).toBe("unknown-".slice(0, 8));
    expect(group.rule).toBeUndefined();
  });

  // Severity comes off the instance's own slo_tier label, so it must not wait
  // on the SLO listing. It used to: an unresolved SLO source took the rule-side
  // "info" default despite having no rule, and sorted to the bottom.
  it("reads an SLO's severity before the SLO listing has caught up", () => {
    const alerts = [
      alertingAlert({
        key: "fp-fast",
        rule: SLO_ID,
        slo: SLO_ID,
        labels: { slo_tier: "fast-burn" },
      }),
    ];
    const [resolved] = alertingGroupInstances(
      resolve({ alerts, slos: [alertingSlo()] }),
    );
    const [unresolved] = alertingGroupInstances(resolve({ alerts, slos: [] }));

    expect(resolved.severity).toBe("critical");
    expect(unresolved.severity).toBe("critical");
    // The name still degrades to the short uuid, as it must: that one really
    // does need the listing.
    expect(unresolved.name).toBe(SLO_ID.slice(0, 8));
  });

  it("still collapses tiers when the SLO listing has not caught up", () => {
    const tier = (slo_tier: string, key: string) =>
      alertingAlert({
        key,
        rule: SLO_ID,
        slo: SLO_ID,
        labels: { slo_tier },
      });
    const [group] = alertingGroupInstances(
      resolve({
        alerts: [tier("fast-burn", "fp-fast"), tier("ticket", "fp-ticket")],
        slos: [],
      }),
    );

    expect(group.rows).toHaveLength(1);
    expect(group.rows[0].tiers).toEqual(["fast-burn", "ticket"]);
  });
});

describe("alertingSourceScopedSilenceMatchers", () => {
  it("pins every label plus a synthetic rule matcher", () => {
    expect(alertingSourceScopedSilenceMatchers(alertingAlert())).toEqual([
      { label: "host", op: "eq", value: "web-1" },
      { label: "rule", op: "eq", value: "rule-1" },
    ]);
  });

  it("scopes an SLO-sourced instance by slo, not rule, and never by tier", () => {
    const alert = alertingAlert({
      rule: SLO_ID,
      slo: SLO_ID,
      labels: { slo_tier: "fast-burn" },
    });
    // The board shows the SLO as one row across every tier, so muting it must
    // mute every tier: pinning slo_tier would leave the same problem
    // paging from the next tier down.
    expect(alertingSourceScopedSilenceMatchers(alert)).toEqual([
      { label: "slo", op: "eq", value: SLO_ID },
    ]);
  });
});
