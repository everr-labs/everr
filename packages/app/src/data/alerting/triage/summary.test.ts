import { describe, expect, it } from "vitest";
import type {
  AlertingAlert,
  AlertingRoute,
  AlertingRuleView,
  AlertingSilence,
} from "@/data/alerting/types";
import { alertingRuleViewFixture } from "../test-fixtures";
import {
  alertingActiveGroups,
  alertingGroupInstances,
  alertingResolveTriageInstances,
  alertingSourceScopedSilenceMatchers,
  alertingTriageCounts,
} from "./summary";

const NOW = Date.parse("2026-07-30T12:00:00Z");

function alertingRule(
  overrides: Partial<AlertingRuleView> = {},
): AlertingRuleView {
  return alertingRuleViewFixture({
    id: "rule-1",
    spec: {
      interval_secs: 30,
      label_columns: ["host"],
      condition: { operator: "gt", threshold: 0 },
      annotations: { "everr.display.name": "Flapping check" },
    },
    ...overrides,
  });
}

function alertingAlert(overrides: Partial<AlertingAlert> = {}): AlertingAlert {
  return {
    key: "fp-1",
    fingerprint: "fp-1",
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
  routes?: AlertingRoute[];
  silences?: AlertingSilence[];
}) {
  return alertingResolveTriageInstances({
    alerts: input.alerts,
    rules: input.rules ?? [alertingRule()],
    routes: input.routes ?? [alertingRoute()],
    silences: input.silences ?? [],
    now: NOW,
  });
}

describe("alertingResolveTriageInstances", () => {
  it("resolves a rule-sourced instance to its rule, routes, and silence", () => {
    const [inst] = resolve({ alerts: [alertingAlert()] });
    expect(inst.rule?.id).toBe("rule-1");
    expect(inst.matchedRoutes.map((r) => r.receiver)).toEqual(["oncall"]);
    expect(inst.silence).toBeNull();
  });

  it("uses explicit channels instead of matching advanced routes", () => {
    const [inst] = resolve({
      alerts: [alertingAlert()],
      rules: [alertingRule({ notification_channels: ["team-slack"] })],
    });

    expect(inst.directChannels).toEqual(["team-slack"]);
    expect(inst.matchedRoutes).toEqual([]);
    expect(
      alertingTriageCounts(alertingGroupInstances([inst]), [], NOW),
    ).toMatchObject({ firing: 1, undeliveredFiring: 0 });
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
    // rows. The single route matches host=web-1, so fp-3 is firing-undelivered.
    // but it is silenced, so it does not count as undelivered either.
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
      undeliveredFiring: 0,
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
      undeliveredFiring: 1,
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
});

describe("alertingActiveGroups", () => {
  it("keeps firing and pending rows and drops inactive ones", () => {
    const groups = alertingGroupInstances(
      resolve({
        alerts: [
          alertingAlert({ key: "fp-firing", fingerprint: "fp-firing" }),
          alertingAlert({
            key: "fp-pending",
            fingerprint: "fp-pending",
            status: "pending",
          }),
          alertingAlert({
            key: "fp-inactive",
            fingerprint: "fp-inactive",
            status: "inactive",
          }),
        ],
      }),
    );

    const active = alertingActiveGroups(groups);

    expect(active.flatMap((g) => g.rows.map((r) => r.lead.alert.key))).toEqual([
      "fp-firing",
      "fp-pending",
    ]);
  });

  it("drops a rule whose every instance is inactive", () => {
    const groups = alertingGroupInstances(
      resolve({
        alerts: [alertingAlert({ status: "inactive" })],
      }),
    );

    expect(alertingActiveGroups(groups)).toEqual([]);
  });
});

describe("alertingSourceScopedSilenceMatchers", () => {
  it("pins every label plus a synthetic rule matcher", () => {
    expect(alertingSourceScopedSilenceMatchers(alertingAlert())).toEqual([
      { label: "host", op: "eq", value: "web-1" },
      { label: "rule", op: "eq", value: "rule-1" },
    ]);
  });
});
