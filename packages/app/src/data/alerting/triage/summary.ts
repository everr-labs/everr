import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  alertingDispatchLabels,
  alertingMatchingSilence,
  alertingSelectRoutes,
} from "@/data/alerting/routing/resolution";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingBudgetExhausted,
  alertingSloIdentity,
  alertingSloTierSeverity,
} from "@/data/alerting/slos/model";
import type {
  AlertingAlert,
  AlertingMatcher,
  AlertingRoute,
  AlertingRuleView,
  AlertingSilence,
  AlertingSlo,
  AlertingSloStatusPayload,
} from "@/data/alerting/types";

// All triage surfaces use this range because the alerts layout has no time picker.
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

export function alertingRunbookParams(
  rule: AlertingRuleView | undefined,
): { project: string; slug: string } | null {
  return rule ? alertingRuleIdentity(rule).runbook : null;
}

function alertingSloInstanceSeverity(alert: AlertingAlert) {
  return alertingSloTierSeverity(ALERTING_CANONICAL_SLO_TIERS, alert.labels);
}

// A rule silence targets one instance. An SLO silence targets all burn tiers.
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

export function alertingGroupSilenceMatchers(
  group: TriageGroup,
): AlertingMatcher[] {
  return [
    group.sloId !== undefined
      ? { label: "slo", op: "eq" as const, value: group.sloId }
      : { label: "rule", op: "eq" as const, value: group.sourceId },
  ];
}

// A dead receiver has no channel or does not exist.
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

export function alertingInstanceIsUndeliverable(
  instance: TriageInstance,
  channelsByReceiver?: Map<string, string[]>,
): boolean {
  if (instance.directChannels.length > 0) return false;
  if (instance.matchedRoutes.length === 0) return true;
  if (channelsByReceiver === undefined) return false;
  return (
    alertingDeliveryFanout(instance.matchedRoutes, channelsByReceiver).channels
      .length === 0
  );
}

// Start the log search before the alert fired. Map only known service labels
// because other labels can be arbitrary SQL columns.
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

// An instance resolves to either a rule or an SLO.
export type TriageInstance = {
  alert: AlertingAlert;
  rule: AlertingRuleView | undefined;
  slo: AlertingSlo | undefined;
  directChannels: string[];
  matchedRoutes: AlertingRoute[];
  silence: AlertingSilence | null;
};

// A rule row contains one instance. An SLO row contains all tiers for one budget.
export type TriageRow = {
  lead: TriageInstance;
  members: TriageInstance[];
  tiers: string[];
};

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

// Return exhausted SLOs from worst to best. Skip paused SLOs because their
// snapshots do not represent current state.
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

// Keep only groups that contain firing rows.
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
    // alert.rule contains the source ID for rules and SLOs.
    const slo = alert.slo !== undefined ? sloById.get(alert.slo) : undefined;
    const rule = alert.slo === undefined ? ruleById.get(alert.rule) : undefined;
    const matchLabels = alertingDispatchLabels(alert, rule, slo);
    const directChannels = rule?.notification_channels ?? [];
    return {
      alert,
      rule,
      slo,
      directChannels,
      matchedRoutes:
        directChannels.length > 0
          ? []
          : alertingSelectRoutes(routes, matchLabels),
      silence: alertingMatchingSilence(matchLabels, silences, now),
    };
  });
}

// Count rows so the summary and board use the same totals. Multiple firing
// tiers for one SLO count as one row.
export function alertingTriageCounts(
  groups: TriageGroup[],
  silences: AlertingSilence[],
  now: number,
  channelsByReceiver?: Map<string, string[]>,
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
        // A silenced row does not need a route.
        if (
          lead.silence === null &&
          alertingInstanceIsUndeliverable(lead, channelsByReceiver)
        ) {
          unroutedFiring += 1;
        }
      } else if (lead.alert.status === "pending") {
        pending += 1;
      }
      // Do not count inactive rows as silenced.
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

// Collapse all tiers for one SLO into one row. Keep rule instances separate.
function alertingCollapseRows(
  list: TriageInstance[],
  isSlo: boolean,
): TriageRow[] {
  if (!isSlo) {
    return list.map((lead) => ({ lead, members: [lead], tiers: [] }));
  }
  return [list].map((members) => {
    // The first canonical tier has the highest urgency.
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

// Sort groups by status, severity, and name. Sort rows by status.
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
      // Preserve the SLO source while its definition is loading.
      const sloId = list[0].alert.slo;
      const isSlo = slo !== undefined || sloId !== undefined;
      // Read severity from the instance until the SLO definition loads.
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
        // Active status takes priority over severity.
        (STATUS_RANK[a.rows[0].lead.alert.status] ?? 3) -
          (STATUS_RANK[b.rows[0].lead.alert.status] ?? 3) ||
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
        a.name.localeCompare(b.name),
    );
}
