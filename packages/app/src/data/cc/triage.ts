// The triage board's derivation, kept out of the route so it can be reasoned
// about (and tested) without rendering anything. Every function here is pure:
// `now` is always a parameter, never a `Date.now()` call, so callers control
// staleness and tests are deterministic.
import type { TimeRange } from "@everr/ui/lib/time-range";
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import {
  ccDispatchLabels,
  ccMatchingSilence,
  ccSelectRoutes,
} from "@/data/cc/route-resolution";
import {
  CC_CANONICAL_SLO_TIERS,
  ccSloIdentity,
  ccSloTierSeverity,
} from "@/data/cc/slo";
import type {
  CcAlert,
  CcMatcher,
  CcRoute,
  CcRuleView,
  CcSilence,
  CcSlo,
} from "@/data/cc/types";

// The alerts layout hides the global time-range picker, so every triage surface
// reads the same fixed trailing window of stored events: the board's all-clear
// freshness line, the recent-events feed, and each expanded row's evidence.
export const TRIAGE_EVENT_RANGE: TimeRange = { from: "now-24h", to: "now" };

// ── Vocabulary helpers ────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
const STATUS_RANK: Record<string, number> = {
  firing: 0,
  pending: 1,
  inactive: 2,
};

function ccRuleDisplayName(
  rule: CcRuleView | undefined,
  ruleId: string,
): string {
  return rule ? ccRuleIdentity(rule).name : ruleId.slice(0, 8);
}

/** /runbooks/$project/$slug params when the rule links a runbook, else null. */
export function ccRunbookParams(
  rule: CcRuleView | undefined,
): { project: string; slug: string } | null {
  return rule ? ccRuleIdentity(rule).runbook : null;
}

/** The severity an SLO-sourced instance fires at: its tier's severity. */
export function ccSloInstanceSeverity(alert: CcAlert) {
  return ccSloTierSeverity(CC_CANONICAL_SLO_TIERS, alert.labels);
}

/**
 * The matchers a silence created from this instance carries: every instance
 * label pinned with `eq`, plus a synthetic scoping label — `slo` for
 * SLO-sourced instances, `rule` otherwise (the dispatcher matches silences
 * against synthetic labels, so a label-free source still gets a working,
 * precisely scoped silence).
 */
export function ccSourceScopedSilenceMatchers(alert: CcAlert): CcMatcher[] {
  return [
    ...Object.entries(alert.labels).map(([label, value]) => ({
      label,
      op: "eq" as const,
      value,
    })),
    alert.slo !== undefined
      ? { label: "slo", op: "eq" as const, value: alert.slo }
      : { label: "rule", op: "eq" as const, value: alert.rule },
  ];
}

/**
 * Search params for a Logs link scoped to this instance: the window from
 * shortly before it started firing until now, plus the shared service filter
 * when the instance carries a service-shaped label. Labels are arbitrary SQL
 * columns, so only the well-known service key maps to an explorer filter —
 * anything cleverer would silently build wrong queries.
 */
export function ccInstanceLogsSearch(alert: CcAlert): {
  from: string;
  to: string;
  service?: string[];
} {
  const activeMs = alert.active_since
    ? new Date(alert.active_since).getTime()
    : Date.now() - 3_600_000;
  const serviceKey = Object.keys(alert.labels).find((k) =>
    /^service([_-]?name)?$/i.test(k),
  );
  return {
    from: new Date(activeMs - 15 * 60_000).toISOString(),
    to: "now",
    ...(serviceKey ? { service: [alert.labels[serviceKey]] } : {}),
  };
}

// ── Shapes ────────────────────────────────────────────────────────────────────

// One triage row: the instance plus every fact the board derives for it.
// `rule` and `slo` are mutually exclusive resolutions of the instance's
// source (alert.slo discriminates).
export type TriageInstance = {
  alert: CcAlert;
  rule: CcRuleView | undefined;
  slo: CcSlo | undefined;
  matchedRoutes: CcRoute[];
  silence: CcSilence | null;
};

/** One source's rows: a rule's, or an SLO's burn-rate alerting. */
export type TriageGroup = {
  sourceId: string;
  rule: CcRuleView | undefined;
  slo: CcSlo | undefined;
  sloId: string | undefined;
  name: string;
  severity: string;
  instances: TriageInstance[];
};

// Only the keys live here; their button labels are display copy and belong with
// the control that renders them (triage-board.tsx).
const TRIAGE_LENS_KEYS = ["firing", "silenced", "all"] as const;
export type TriageLensKey = (typeof TRIAGE_LENS_KEYS)[number];

// ── Derivation ────────────────────────────────────────────────────────────────

/**
 * Every derived fact for every instance, resolved once with the engine's own
 * matching semantics (synthetic labels, priority + continue routes).
 */
export function ccResolveTriageInstances({
  alerts,
  rules,
  slos,
  routes,
  silences,
  now,
}: {
  alerts: CcAlert[];
  rules: CcRuleView[];
  slos: CcSlo[];
  routes: CcRoute[];
  silences: CcSilence[];
  now: number;
}): TriageInstance[] {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const sloById = new Map(slos.map((s) => [s.id, s]));
  return alerts.map((alert) => {
    // `alert.rule` carries the source uuid for SLO rows too (CC's wire
    // convention); `alert.slo` discriminates, so exactly one side resolves.
    const slo = alert.slo !== undefined ? sloById.get(alert.slo) : undefined;
    const rule = alert.slo === undefined ? ruleById.get(alert.rule) : undefined;
    const matchLabels = ccDispatchLabels(alert, rule, slo);
    return {
      alert,
      rule,
      slo,
      matchedRoutes: ccSelectRoutes(routes, matchLabels),
      silence: ccMatchingSilence(matchLabels, silences, now),
    };
  });
}

/**
 * Every number the pipeline strip reads off the instance list, accumulated in
 * one pass. Callers must not re-derive any of these with their own filters: a
 * count that lives half here and half in a route drifts the moment one side
 * changes its definition of, say, "unrouted".
 */
export function ccTriageCounts(
  instances: TriageInstance[],
  silences: CcSilence[],
  now: number,
): {
  firing: number;
  pending: number;
  silenced: number;
  unroutedFiring: number;
  activeSilences: number;
} {
  let firing = 0;
  let pending = 0;
  let silenced = 0;
  let unroutedFiring = 0;
  for (const i of instances) {
    if (i.alert.status === "firing") {
      firing += 1;
      // Unrouted only counts what nothing is muting: a silenced instance is
      // meant not to reach anyone.
      if (i.silence === null && i.matchedRoutes.length === 0) {
        unroutedFiring += 1;
      }
    } else if (i.alert.status === "pending") {
      pending += 1;
    }
    // Silenced counts active instances only; an inactive row matched by a
    // silence is not being muted, it is simply over.
    if (i.alert.status !== "inactive" && i.silence !== null) silenced += 1;
  }
  return {
    firing,
    pending,
    silenced,
    unroutedFiring,
    activeSilences: silences.filter(
      (s) =>
        new Date(s.starts_at).getTime() <= now &&
        now < new Date(s.ends_at).getTime(),
    ).length,
  };
}

export function ccVisibleInstances(
  instances: TriageInstance[],
  lens: TriageLensKey,
): TriageInstance[] {
  const active = instances.filter((i) => i.alert.status !== "inactive");
  if (lens === "firing") return active.filter((i) => i.silence === null);
  if (lens === "silenced") return active.filter((i) => i.silence !== null);
  return instances;
}

// Group by source (rule or SLO — `alert.rule` carries the uuid for both),
// severity-sorted (critical → warning → info), then by name; within a group
// firing instances precede pending (muted) and inactive. An SLO group's
// severity is the highest tier severity among its visible instances (each
// burn-rate instance fires at its own tier's severity).
export function ccGroupInstances(visible: TriageInstance[]): TriageGroup[] {
  const bySource = new Map<string, TriageInstance[]>();
  for (const inst of visible) {
    const list = bySource.get(inst.alert.rule) ?? [];
    list.push(inst);
    bySource.set(inst.alert.rule, list);
  }
  return [...bySource.entries()]
    .map(([sourceId, list]) => {
      const slo = list[0].slo;
      // The instance knows it is SLO-sourced even before the SLO listing
      // resolves the object, so linking/marking never falls back to a rule.
      const sloId = list[0].alert.slo;
      const severity = slo
        ? list.reduce((top: string, inst) => {
            const s = ccSloInstanceSeverity(inst.alert);
            return (SEVERITY_RANK[s] ?? 3) < (SEVERITY_RANK[top] ?? 3)
              ? s
              : top;
          }, "info" as string)
        : (list[0].rule?.spec.severity ?? "info");
      return {
        sourceId,
        rule: list[0].rule,
        slo,
        sloId,
        name: slo
          ? ccSloIdentity(slo).name
          : sloId !== undefined
            ? sloId.slice(0, 8)
            : ccRuleDisplayName(list[0].rule, sourceId),
        severity,
        instances: [...list].sort(
          (a, b) =>
            (STATUS_RANK[a.alert.status] ?? 3) -
              (STATUS_RANK[b.alert.status] ?? 3) ||
            (a.alert.active_since ?? "").localeCompare(
              b.alert.active_since ?? "",
            ),
        ),
      };
    })
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
        a.name.localeCompare(b.name),
    );
}
