import type { TimeRange } from "@everr/ui/lib/time-range";
import type { AlertingDefaultTier } from "@/data/alerting/delivery/defaults";
import { alertingRuleIdentity } from "@/data/alerting/rules/identity";
import {
  alertingDispatchLabels,
  alertingMatchingSilence,
  alertingSilenceIsActive,
} from "@/data/alerting/silences/matching";
import type {
  AlertingAlert,
  AlertingDefaultDestination,
  AlertingMatcher,
  AlertingRuleView,
  AlertingSeverity,
  AlertingSilence,
} from "@/data/alerting/types";

export const TRIAGE_EVENT_RANGE: TimeRange = { from: "now-24h", to: "now" };

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
export const STATUS_RANK: Record<string, number> = {
  firing: 0,
  pending: 1,
  inactive: 2,
};

/**
 * When an alert's current status began. The engine only ever writes
 * `active_since` on the transition into firing (see `advanceAlertInstance`),
 * so it stays null for the whole time an alert is pending; `pending_since` is
 * the field that carries that start time until then.
 */
export function alertingStatusSince(alert: AlertingAlert): string | null {
  return alert.status === "pending"
    ? (alert.pending_since ?? null)
    : alert.active_since;
}

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

export function alertingSourceScopedSilenceMatchers(
  alert: AlertingAlert,
): AlertingMatcher[] {
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
  return [{ label: "rule", op: "eq", value: group.sourceId }];
}

/**
 * The default-destination channels this severity delivers to: the unsplit
 * "all" tier when present, else the severity's own tier.
 */
export function alertingDefaultChannelsFor(
  destination: AlertingDefaultDestination,
  severity: AlertingSeverity,
): string[] {
  const all = destination.tiers.all;
  if (all !== undefined) return all;
  return destination.tiers[severity as AlertingDefaultTier] ?? [];
}

export function alertingInstanceIsUndelivered(
  instance: TriageInstance,
  destination?: AlertingDefaultDestination,
): boolean {
  if ((instance.rule?.spec.notifications?.channels ?? []).length > 0)
    return false;
  if (destination === undefined) return false;
  const severity = instance.rule?.spec.severity ?? "info";
  return alertingDefaultChannelsFor(destination, severity).length === 0;
}

export type TriageInstance = {
  alert: AlertingAlert;
  rule: AlertingRuleView | undefined;
  silence: AlertingSilence | null;
};

export type TriageRow = {
  lead: TriageInstance;
  members: TriageInstance[];
};

export type TriageGroup = {
  sourceId: string;
  rule: AlertingRuleView | undefined;
  name: string;
  severity: AlertingSeverity;
  rows: TriageRow[];
};

/**
 * Groups cut to the instances a reader has to act on: firing now, or pending
 * and on the way. Pending belongs on the board, because a rule minutes from
 * paging is the reader's business. The row carries its own status, so the two
 * never read as the same thing.
 */
export function alertingActiveGroups(groups: TriageGroup[]): TriageGroup[] {
  return groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter(
        (row) =>
          row.lead.alert.status === "firing" ||
          row.lead.alert.status === "pending",
      ),
    }))
    .filter((group) => group.rows.length > 0);
}

export function alertingResolveTriageInstances({
  alerts,
  rules,
  silences,
  now,
}: {
  alerts: AlertingAlert[];
  rules: AlertingRuleView[];
  silences: AlertingSilence[];
  now: number;
}): TriageInstance[] {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  return alerts.map((alert) => {
    const rule = ruleById.get(alert.rule);
    const matchLabels = alertingDispatchLabels(alert, rule);
    return {
      alert,
      rule,
      silence: alertingMatchingSilence(matchLabels, silences, now),
    };
  });
}

export function alertingTriageCounts(
  groups: TriageGroup[],
  silences: AlertingSilence[],
  now: number,
  destination?: AlertingDefaultDestination,
): {
  firing: number;
  pending: number;
  silenced: number;
  undeliveredFiring: number;
  activeSilences: number;
} {
  let firing = 0;
  let pending = 0;
  let silenced = 0;
  let undeliveredFiring = 0;
  for (const group of groups) {
    for (const { lead } of group.rows) {
      if (lead.alert.status === "firing") {
        firing += 1;
        if (
          lead.silence === null &&
          alertingInstanceIsUndelivered(lead, destination)
        ) {
          undeliveredFiring += 1;
        }
      } else if (lead.alert.status === "pending") {
        pending += 1;
      }
      if (lead.alert.status !== "inactive" && lead.silence !== null) {
        silenced += 1;
      }
    }
  }
  return {
    firing,
    pending,
    silenced,
    undeliveredFiring,
    activeSilences: silences.filter((s) => alertingSilenceIsActive(s, now))
      .length,
  };
}

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
    .map(([sourceId, list]) => ({
      sourceId,
      rule: list[0].rule,
      name: alertingRuleDisplayName(list[0].rule, sourceId),
      severity: list[0].rule?.spec.severity ?? "info",
      rows: list
        .map((lead) => ({ lead, members: [lead] }))
        .sort(
          (a, b) =>
            (STATUS_RANK[a.lead.alert.status] ?? 3) -
              (STATUS_RANK[b.lead.alert.status] ?? 3) ||
            (a.lead.alert.active_since ?? "").localeCompare(
              b.lead.alert.active_since ?? "",
            ),
        ),
    }))
    .sort(
      (a, b) =>
        (STATUS_RANK[a.rows[0].lead.alert.status] ?? 3) -
          (STATUS_RANK[b.rows[0].lead.alert.status] ?? 3) ||
        (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
        a.name.localeCompare(b.name),
    );
}
