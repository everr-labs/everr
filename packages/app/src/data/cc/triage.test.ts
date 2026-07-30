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
  ccVisibleInstances,
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
    expect(ccTriageCounts(instances, [ccSilence()], NOW)).toEqual({
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
    expect(ccTriageCounts(instances, [], NOW)).toMatchObject({
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

describe("ccVisibleInstances", () => {
  const instances = () =>
    resolve({
      alerts: [
        ccAlert(),
        ccAlert({ key: "fp-3", labels: { svc: "api" } }),
        ccAlert({ key: "fp-4", status: "inactive", labels: { host: "web-9" } }),
      ],
      silences: [ccSilence()],
    });

  it("firing shows active unsilenced instances only", () => {
    const keys = ccVisibleInstances(instances(), "firing").map(
      (i) => i.alert.key,
    );
    expect(keys).toEqual(["fp-1"]);
  });

  it("silenced shows active silenced instances only", () => {
    const keys = ccVisibleInstances(instances(), "silenced").map(
      (i) => i.alert.key,
    );
    expect(keys).toEqual(["fp-3"]);
  });

  it("all shows everything, inactive included", () => {
    const keys = ccVisibleInstances(instances(), "all").map((i) => i.alert.key);
    expect(keys).toEqual(["fp-1", "fp-3", "fp-4"]);
  });
});

describe("ccGroupInstances", () => {
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

  it("sorts firing before pending within a group", () => {
    const instances = resolve({
      alerts: [
        ccAlert({ key: "fp-2", status: "pending", labels: { host: "web-2" } }),
        ccAlert(),
      ],
    });
    const [group] = ccGroupInstances(instances);
    expect(group.instances.map((i) => i.alert.status)).toEqual([
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
});

describe("ccSourceScopedSilenceMatchers", () => {
  it("pins every label plus a synthetic rule matcher", () => {
    expect(ccSourceScopedSilenceMatchers(ccAlert())).toEqual([
      { label: "host", op: "eq", value: "web-1" },
      { label: "rule", op: "eq", value: "rule-1" },
    ]);
  });

  it("scopes an SLO-sourced instance by slo, not rule", () => {
    const alert = ccAlert({
      rule: SLO_ID,
      slo: SLO_ID,
      labels: { service: "checkout", slo_tier: "fast-burn" },
    });
    expect(ccSourceScopedSilenceMatchers(alert)).toEqual([
      { label: "service", op: "eq", value: "checkout" },
      { label: "slo_tier", op: "eq", value: "fast-burn" },
      { label: "slo", op: "eq", value: SLO_ID },
    ]);
  });
});
