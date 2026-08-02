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
  ccBudgetExhausted,
  ccSloIdentity,
  ccSloLabelsKey,
  ccSloTierSeverity,
} from "@/data/cc/slo";
import type {
  CcAlert,
  CcMatcher,
  CcRoute,
  CcRuleView,
  CcSilence,
  CcSlo,
  CcSloGroupStatus,
} from "@/data/cc/types";

// The alerts layout hides the global time-range picker, so every triage surface
// reads the same fixed trailing window of stored events: the board's all-clear
// freshness line and each expanded row's evidence.
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
function ccSloInstanceSeverity(alert: CcAlert) {
  return ccSloTierSeverity(CC_CANONICAL_SLO_TIERS, alert.labels);
}

/**
 * The matchers a silence created from this instance carries: every instance
 * label pinned with `eq`, plus a synthetic scoping label — `slo` for
 * SLO-sourced instances, `rule` otherwise (the dispatcher matches silences
 * against synthetic labels, so a label-free source still gets a working,
 * precisely scoped silence).
 *
 * `slo_tier` is deliberately not pinned. A board row is one label set across
 * every tier watching it, so silencing that row must mute all of them; pinning
 * the tier would leave the same problem paging from the next tier down.
 */
export function ccSourceScopedSilenceMatchers(alert: CcAlert): CcMatcher[] {
  const isSlo = alert.slo !== undefined;
  return [
    ...Object.entries(alert.labels)
      .filter(([label]) => !(isSlo && label === "slo_tier"))
      .map(([label, value]) => ({
        label,
        op: "eq" as const,
        value,
      })),
    isSlo && alert.slo !== undefined
      ? { label: "slo", op: "eq" as const, value: alert.slo }
      : { label: "rule", op: "eq" as const, value: alert.rule },
  ];
}

/**
 * The single matcher a whole-source silence carries: the same synthetic
 * scoping label ccSourceScopedSilenceMatchers pins, without the per-instance
 * labels — one silence mutes everything under the source.
 */
export function ccGroupSilenceMatchers(group: TriageGroup): CcMatcher[] {
  return [
    group.sloId !== undefined
      ? { label: "slo", op: "eq" as const, value: group.sloId }
      : { label: "rule", op: "eq" as const, value: group.sourceId },
  ];
}

/**
 * Where a routed instance's notifications actually land: the deduped receiver
 * names, the channels they fan out to, and the receivers that fan out to
 * nothing (no channels configured, or the route names a receiver that does
 * not exist). Matched routes with `channels` empty means delivery reaches no
 * one — the "not routed" trap wearing a receiver name.
 */
export function ccDeliveryFanout(
  matchedRoutes: CcRoute[],
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

// One engine instance plus every fact the board derives for it. `rule` and
// `slo` are mutually exclusive resolutions of the instance's source
// (alert.slo discriminates).
export type TriageInstance = {
  alert: CcAlert;
  rule: CcRuleView | undefined;
  slo: CcSlo | undefined;
  matchedRoutes: CcRoute[];
  silence: CcSilence | null;
};

/**
 * One board row: one thing that is wrong. For a rule that is one instance,
 * since an instance already is one label set. For an SLO it is one label set
 * across every burn-rate tier currently on it: the tiers are three
 * sensitivities watching the same budget, so a service burning fast enough to
 * trip two of them is still one problem, and listing it twice reads as two.
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
  rule: CcRuleView | undefined;
  slo: CcSlo | undefined;
  sloId: string | undefined;
  name: string;
  severity: string;
  rows: TriageRow[];
};

// ── Error budget ──────────────────────────────────────────────────────────────

/**
 * Budget remaining by label-set key for one SLO's status groups, computed
 * once so each board row is a single key derivation and an O(1) lookup
 * instead of re-keying every group per row.
 */
export function ccBudgetIndex(
  statusGroups: CcSloGroupStatus[],
): Map<string, number | null> {
  return new Map(
    statusGroups.map((g) => [labelSetKey(g.labels), g.budget_remaining]),
  );
}

/**
 * This row's own error budget remaining, from the status group whose labels
 * equal the row's label set — not the SLO's worst group, which may be a
 * different label set entirely. Null when the status has not resolved or
 * carries no matching group (a snapshot can lag a newly-firing label set).
 */
export function ccRowBudget(
  row: TriageRow,
  index: Map<string, number | null> | undefined,
): number | null {
  return index?.get(labelSetKey(row.lead.alert.labels)) ?? null;
}

/** One spent budget: an SLO label-set group with nothing left. */
export type CcExhaustedBudget = {
  slo: CcSlo;
  group: CcSloGroupStatus;
};

/**
 * Every SLO label-set whose error budget is spent, worst first — the standing
 * damage, whether or not anything is firing on it right now (burn may have
 * stopped after the harm, or still be running; either way the budget is
 * gone, which is its own operational state: a deploy freeze, for teams that
 * practice one). Paused SLOs are skipped: their snapshots are frozen, and a
 * stale "exhausted" would be a claim the engine is no longer making.
 */
export function ccExhaustedBudgets(
  slos: CcSlo[],
  statusGroupsBySlo: Map<string, CcSloGroupStatus[]>,
): CcExhaustedBudget[] {
  const spent: { entry: CcExhaustedBudget; remaining: number }[] = [];
  for (const slo of slos) {
    if (slo.paused) continue;
    for (const group of statusGroupsBySlo.get(slo.id) ?? []) {
      const remaining = group.budget_remaining;
      if (ccBudgetExhausted(remaining)) {
        spent.push({ entry: { slo, group }, remaining });
      }
    }
  }
  return spent.sort((a, b) => a.remaining - b.remaining).map((s) => s.entry);
}

/**
 * The board's cut of the grouped rows: firing only. Pending and inactive
 * instances stay in the derivation (the pipeline strip counts them), but
 * triage lists what is wrong right now, and a row that is not firing is not
 * that. Groups left with no firing row disappear entirely.
 */
export function ccFiringGroups(groups: TriageGroup[]): TriageGroup[] {
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => row.lead.alert.status === "firing"),
    }))
    .filter((group) => group.rows.length > 0);
}

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
 * Every number the pipeline strip reads, accumulated in one pass over the
 * grouped rows. Callers must not re-derive any of these with their own
 * filters: a count that lives half here and half in a route drifts the moment
 * one side changes its definition of, say, "unrouted".
 *
 * These count rows, not engine instances, so the strip and the board are the
 * same tally. An SLO burning fast enough to trip two tiers is one firing thing
 * in both places; counting its tiers here would have the strip claim two
 * problems the board shows as one.
 */
export function ccTriageCounts(
  groups: TriageGroup[],
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
  for (const group of groups) {
    for (const { lead } of group.rows) {
      if (lead.alert.status === "firing") {
        firing += 1;
        // Unrouted only counts what nothing is muting: a silenced row is meant
        // not to reach anyone.
        if (lead.silence === null && lead.matchedRoutes.length === 0) {
          unroutedFiring += 1;
        }
      } else if (lead.alert.status === "pending") {
        pending += 1;
      }
      // Silenced counts active rows only; an inactive row matched by a silence
      // is not being muted, it is simply over.
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

/** A label set's identity, ignoring which burn-rate tier reported it: the
 *  SLO pages' canonical group key over the tier-stripped labels, so a board
 *  row and a status group agree on "same group" by construction. */
function labelSetKey(labels: Record<string, string>): string {
  return ccSloLabelsKey(
    Object.fromEntries(
      Object.entries(labels).filter(([k]) => k !== "slo_tier"),
    ),
  );
}

const TIER_RANK = new Map(CC_CANONICAL_SLO_TIERS.map((t, i) => [t.name, i]));

/**
 * Collapse an SLO's instances into one row per label set, most urgent member
 * leading. Rule instances pass through one-to-one: an instance already is a
 * label set, so nothing to merge.
 */
function ccCollapseRows(list: TriageInstance[], isSlo: boolean): TriageRow[] {
  if (!isSlo) {
    return list.map((lead) => ({ lead, members: [lead], tiers: [] }));
  }
  const byLabels = new Map<string, TriageInstance[]>();
  for (const inst of list) {
    const key = labelSetKey(inst.alert.labels);
    byLabels.set(key, [...(byLabels.get(key) ?? []), inst]);
  }
  return [...byLabels.values()].map((members) => {
    // Canonical tier order is urgency order (fast-burn → slow-burn → ticket),
    // so the earliest tier leads and its burn rate is the row's value.
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

// Group by source (rule or SLO — `alert.rule` carries the uuid for both).
// Groups sort by what they are doing now (any firing row first, then pending,
// then all-inactive), then by severity (critical → warning → info), then by
// name; within a group firing rows precede pending (muted) and inactive. An
// SLO group's severity is the highest tier severity among its instances (each
// burn-rate instance fires at its own tier's severity).
export function ccGroupInstances(instances: TriageInstance[]): TriageGroup[] {
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
      // Keyed on `isSlo`, not on the resolved SLO: an instance's severity is
      // its tier's, read off its own `slo_tier` label, so it does not need the
      // listing. Waiting for the object would render a critical burn as
      // "info" (the rule-side default, on a group that has no rule) and sort
      // it to the bottom until the fetch landed.
      const severity = isSlo
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
        rows: ccCollapseRows(list, isSlo).sort(
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
        // Each group's rows are already status-sorted, so [0] is its most
        // urgent one. Ordering on that first floats firing groups above
        // pending ones and pending above all-inactive; severity then orders
        // within each band. Without it a critical group that has finished
        // firing would outrank a warning group that is firing right now.
        (STATUS_RANK[a.rows[0].lead.alert.status] ?? 3) -
          (STATUS_RANK[b.rows[0].lead.alert.status] ?? 3) ||
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
        a.name.localeCompare(b.name),
    );
}
