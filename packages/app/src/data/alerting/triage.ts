// Every function here is pure: `now` is always a parameter, never a
// `Date.now()` call, so callers control staleness and tests are deterministic.
import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  alertingDispatchLabels,
  alertingMatchingSilence,
  alertingSelectRoutes,
} from "@/data/alerting/route-resolution";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingBudgetExhausted,
  alertingSloIdentity,
  alertingSloTierSeverity,
} from "@/data/alerting/slo";
import type {
  AlertingAlert,
  AlertingMatcher,
  AlertingRoute,
  AlertingRuleView,
  AlertingSilence,
  AlertingSlo,
  AlertingSloStatusPayload,
} from "@/data/alerting/types";
import { alertingRuleIdentity } from "@/data/alerts/rule-identity";

// The alerts layout hides the global time-range picker, so every triage
// surface reads the same fixed trailing window of stored events.
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

function alertingRuleDisplayName(
  rule: AlertingRuleView | undefined,
  ruleId: string,
): string {
  return rule ? alertingRuleIdentity(rule).name : ruleId.slice(0, 8);
}

/** /runbooks/$project/$slug params when the rule links a runbook, else null. */
export function alertingRunbookParams(
  rule: AlertingRuleView | undefined,
): { project: string; slug: string } | null {
  return rule ? alertingRuleIdentity(rule).runbook : null;
}

function alertingSloInstanceSeverity(alert: AlertingAlert) {
  return alertingSloTierSeverity(ALERTING_CANONICAL_SLO_TIERS, alert.labels);
}

/**
 * Rule instances pin every instance label plus the synthetic `rule` label.
 * SLO rows use only the synthetic `slo` label so one silence covers every burn
 * tier watching that budget.
 */
export function alertingSourceScopedSilenceMatchers(
  alert: AlertingAlert,
): AlertingMatcher[] {
  if (alert.slo !== undefined) {
    return [{ label: "slo", op: "eq", value: alert.slo }];
  }
  return [
    ...Object.entries(alert.labels).map(([label, value]) => ({
      label,
      op: "eq" as const,
      value,
    })),
    { label: "rule", op: "eq", value: alert.rule },
  ];
}

/** The synthetic scoping label alone: one silence mutes everything under the source. */
export function alertingGroupSilenceMatchers(
  group: TriageGroup,
): AlertingMatcher[] {
  return [
    group.sloId !== undefined
      ? { label: "slo", op: "eq" as const, value: group.sloId }
      : { label: "rule", op: "eq" as const, value: group.sourceId },
  ];
}

/**
 * Deduped receivers, the channels they fan out to, and `dead`: receivers that
 * fan out to nothing (no channels, or a receiver that does not exist) —
 * matched routes whose delivery reaches no one.
 */
export function alertingDeliveryFanout(
  matchedRoutes: AlertingRoute[],
  channelsByReceiver: Map<string, string[]>,
): { receivers: string[]; channels: string[]; dead: string[] } {
  const receivers = [...new Set(matchedRoutes.map((r) => r.receiver))];
  const channels = [
    ...new Set(receivers.flatMap((n) => channelsByReceiver.get(n) ?? [])),
  ];
  const dead = receivers.filter(
    (n) => (channelsByReceiver.get(n) ?? []).length === 0,
  );
  return { receivers, channels, dead };
}

/**
 * Logs-link params: window from shortly before firing until now. Labels are
 * arbitrary SQL columns, so only the well-known service key maps to an
 * explorer filter — anything cleverer would silently build wrong queries.
 */
export function alertingInstanceLogsSearch(alert: AlertingAlert): {
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

// `rule` and `slo` are mutually exclusive resolutions of the instance's
// source (alert.slo discriminates).
export type TriageInstance = {
  alert: AlertingAlert;
  rule: AlertingRuleView | undefined;
  slo: AlertingSlo | undefined;
  matchedRoutes: AlertingRoute[];
  silence: AlertingSilence | null;
};

/**
 * One board row: one thing that is wrong. For a rule, one instance; for an
 * SLO, one row across every burn-rate tier on it, because the tiers watch the
 * same budget, so tripping two of them is still one problem.
 */
export type TriageRow = {
  /** The most urgent member: the row's identity, value, and event scope. */
  lead: TriageInstance;
  /** Every member, most urgent first. One element for a rule row. */
  members: TriageInstance[];
  /** Firing tiers, most urgent first. Empty for a rule row. */
  tiers: string[];
};

/** One source's rows: a rule's, or an SLO's burn-rate alerting. */
export type TriageGroup = {
  sourceId: string;
  rule: AlertingRuleView | undefined;
  slo: AlertingSlo | undefined;
  sloId: string | undefined;
  name: string;
  severity: string;
  rows: TriageRow[];
};

// ── Error budget ──────────────────────────────────────────────────────────────

export function alertingRowBudget(
  status: AlertingSloStatusPayload | null | undefined,
): number | null {
  return status?.budget_remaining ?? null;
}

export type AlertingExhaustedBudget = {
  slo: AlertingSlo;
  status: AlertingSloStatusPayload;
};

/**
 * Every SLO whose budget is spent, worst first, whether or not
 * anything is firing on it now. Paused SLOs are skipped: their snapshots are
 * frozen, and a stale "exhausted" would be a claim the engine is no longer
 * making.
 */
export function alertingExhaustedBudgets(
  slos: AlertingSlo[],
  statusBySlo: Map<string, AlertingSloStatusPayload | null>,
): AlertingExhaustedBudget[] {
  const spent: { entry: AlertingExhaustedBudget; remaining: number }[] = [];
  for (const slo of slos) {
    if (slo.paused) continue;
    const status = statusBySlo.get(slo.id);
    const remaining = status?.budget_remaining ?? null;
    if (status && alertingBudgetExhausted(remaining)) {
      spent.push({ entry: { slo, status }, remaining });
    }
  }
  return spent.sort((a, b) => a.remaining - b.remaining).map((s) => s.entry);
}

/**
 * Firing rows only. Pending and inactive instances stay in the derivation
 * (the pipeline strip counts them); groups with no firing row disappear.
 */
export function alertingFiringGroups(groups: TriageGroup[]): TriageGroup[] {
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => row.lead.alert.status === "firing"),
    }))
    .filter((group) => group.rows.length > 0);
}

// ── Derivation ────────────────────────────────────────────────────────────────

export function alertingResolveTriageInstances({
  alerts,
  rules,
  slos,
  routes,
  silences,
  now,
}: {
  alerts: AlertingAlert[];
  rules: AlertingRuleView[];
  slos: AlertingSlo[];
  routes: AlertingRoute[];
  silences: AlertingSilence[];
  now: number;
}): TriageInstance[] {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const sloById = new Map(slos.map((s) => [s.id, s]));
  return alerts.map((alert) => {
    // `alert.rule` carries the source uuid for SLO rows too (alerting engine wire
    // convention); `alert.slo` discriminates, so exactly one side resolves.
    const slo = alert.slo !== undefined ? sloById.get(alert.slo) : undefined;
    const rule = alert.slo === undefined ? ruleById.get(alert.rule) : undefined;
    const matchLabels = alertingDispatchLabels(alert, rule, slo);
    return {
      alert,
      rule,
      slo,
      matchedRoutes: alertingSelectRoutes(routes, matchLabels),
      silence: alertingMatchingSilence(matchLabels, silences, now),
    };
  });
}

/**
 * Callers must not re-derive these with their own filters: a count split
 * between here and a route drifts when one side changes its definition.
 * Counts rows, not engine instances, so the strip and the board are the same
 * tally (an SLO tripping two tiers is one firing thing in both).
 */
export function alertingTriageCounts(
  groups: TriageGroup[],
  silences: AlertingSilence[],
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
  for (const group of groups) {
    for (const { lead } of group.rows) {
      if (lead.alert.status === "firing") {
        firing += 1;
        // A silenced row is meant not to reach anyone, so it is not "unrouted".
        if (lead.silence === null && lead.matchedRoutes.length === 0) {
          unroutedFiring += 1;
        }
      } else if (lead.alert.status === "pending") {
        pending += 1;
      }
      // An inactive row matched by a silence is not being muted, just over.
      if (lead.alert.status !== "inactive" && lead.silence !== null) {
        silenced += 1;
      }
    }
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

const TIER_RANK = new Map(
  ALERTING_CANONICAL_SLO_TIERS.map((t, i) => [t.name, i]),
);

/**
 * Collapse an SLO's tier instances into one row, most urgent member
 * leading. Rule instances pass through one-to-one.
 */
function alertingCollapseRows(
  list: TriageInstance[],
  isSlo: boolean,
): TriageRow[] {
  if (!isSlo) {
    return list.map((lead) => ({ lead, members: [lead], tiers: [] }));
  }
  return [list].map((members) => {
    // Canonical tier order is urgency order, so the earliest tier leads.
    const sorted = [...members].sort(
      (a, b) =>
        (STATUS_RANK[a.alert.status] ?? 3) -
          (STATUS_RANK[b.alert.status] ?? 3) ||
        (TIER_RANK.get(a.alert.labels.slo_tier) ?? TIER_RANK.size) -
          (TIER_RANK.get(b.alert.labels.slo_tier) ?? TIER_RANK.size),
    );
    return {
      lead: sorted[0],
      members: sorted,
      tiers: sorted
        .filter((m) => m.alert.status === "firing")
        .map((m) => m.alert.labels.slo_tier)
        .filter((t): t is string => t !== undefined),
    };
  });
}

// Group by source (`alert.rule` carries the uuid for rules and SLOs alike).
// Ordering guarantee: groups sort status (firing, pending, inactive), then
// severity, then name; within a group firing rows precede pending and inactive.
export function alertingGroupInstances(
  instances: TriageInstance[],
): TriageGroup[] {
  const bySource = new Map<string, TriageInstance[]>();
  for (const inst of instances) {
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
      const isSlo = slo !== undefined || sloId !== undefined;
      // Keyed on `isSlo`, not the resolved SLO: severity reads off the
      // instance's own `slo_tier` label; waiting for the object would render a
      // critical burn as "info" and sort it to the bottom until the fetch landed.
      const severity = isSlo
        ? list.reduce((top: string, inst) => {
            const s = alertingSloInstanceSeverity(inst.alert);
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
          ? alertingSloIdentity(slo).name
          : sloId !== undefined
            ? sloId.slice(0, 8)
            : alertingRuleDisplayName(list[0].rule, sourceId),
        severity,
        rows: alertingCollapseRows(list, isSlo).sort(
          (a, b) =>
            (STATUS_RANK[a.lead.alert.status] ?? 3) -
              (STATUS_RANK[b.lead.alert.status] ?? 3) ||
            (a.lead.alert.active_since ?? "").localeCompare(
              b.lead.alert.active_since ?? "",
            ),
        ),
      };
    })
    .sort(
      (a, b) =>
        // Rows are status-sorted, so [0] is the group's most urgent. Status
        // before severity: otherwise a critical group that finished firing
        // would outrank a warning group firing right now.
        (STATUS_RANK[a.rows[0].lead.alert.status] ?? 3) -
          (STATUS_RANK[b.rows[0].lead.alert.status] ?? 3) ||
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
        a.name.localeCompare(b.name),
    );
}
