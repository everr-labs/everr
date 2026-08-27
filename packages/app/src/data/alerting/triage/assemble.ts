/**
 * The triage screen's views, assembled from rows already loaded.
 *
 * Pure. Everything here takes what the loaders read and returns what the
 * components render, so the semantics of the screen (which clock `since` runs
 * on, which silence a rule is attributed to, what delivery did with the last
 * verdict, what order the board is in) are testable through the same shapes
 * the components see, without a database. `server.ts` loads and calls; the
 * tests build the inputs by hand and call.
 */
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import {
  ANN_ALERTING_DESCRIPTION,
  ANN_ALERTING_LINK_RUNBOOK,
  ANN_ALERTING_SUMMARY,
  ANN_DISPLAY_DESCRIPTION,
} from "@/data/alerting/resource-annotations";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import type {
  AlertingEvaluationSample,
  AlertingSeverity,
} from "@/data/alerting/types";
import { ALERTING_SEVERITIES } from "@/data/alerting/vocabulary";
import {
  formatClock,
  formatElapsed,
  formatSince,
  formatSincePhrase,
  formatValue,
} from "./format";
import {
  type LifecycleEventRow,
  lifecycleLine,
  type PriorStateRow,
  type TimelineRow,
} from "./history";
import {
  type DeliveryFacts,
  hasDeliveryTarget,
  type NotificationFact,
  notificationText,
} from "./notifications";
import {
  conditionText,
  type DefinitionRow,
  type InstanceRow,
  instanceSummary,
  inventoryState,
  measuredText,
  rulePath,
  ruleTitle,
  runbookLabel,
  triageStatus,
  worstInstance,
} from "./rules";
import { type LifecycleRow, ruleStateSegments } from "./segments";
import {
  type SilenceImpactCounts,
  type SilenceRow,
  silenceFor,
  silenceRecords,
  silenceView,
} from "./silences";
import type { InstanceLanes, InstanceValues } from "./values";
import type {
  AlertDetail,
  AlertTriageData,
  ChartWindow,
  LifecycleEvent,
  RuleInventoryRow,
  RuleInventoryState,
  RuleStateHistory,
  RuleStateHistoryData,
  TriageAlert,
  TriageStatus,
} from "./view";

/** The window the reads were bounded to. */
export type Window = { from: Date; to: Date };

function chartWindow(window: Window): ChartWindow {
  return {
    minutes: (window.to.getTime() - window.from.getTime()) / 60_000,
    endsAt: window.to.getTime(),
  };
}

const NO_LANES: InstanceLanes = { lanes: [], hidden: 0 };

/** What delivery knows about every rule in the org, keyed by rule id where a
 *  rule has its own entry. */
export type DeliverySource = {
  now: Date;
  /** Silences whose window covers `now`. */
  silences: SilenceRow[];
  notifications: Map<string, NotificationFact>;
  held: Map<string, number>;
  defaultTiers: Set<string>;
};

function deliveryFor(
  row: DefinitionRow,
  source: DeliverySource,
): DeliveryFacts {
  return {
    latest: source.notifications.get(row.id),
    silence: silenceFor(row.id, row.spec.severity, source.silences, source.now),
    held: source.held.get(row.id) ?? 0,
    hasTarget: hasDeliveryTarget(row, source.defaultTiers),
  };
}

/**
 * The instant the current state began, for the clock a row prints beside it.
 *
 * One ladder for the board and the detail, so a rule never shows one clock in
 * the list and another in the panel. A silenced rule is still firing, and its
 * fire is older than its silence; the phrase says "Silenced", so it counts
 * from the silence.
 */
function stateSince(
  state: RuleInventoryState,
  row: DefinitionRow,
  worst: InstanceRow | null,
  silence: SilenceRow | null,
): Date | null {
  switch (state) {
    case "degraded":
      return row.degradedSince;
    case "pending":
      return worst?.pendingSince ?? null;
    case "firing":
      return worst?.activeSince ?? row.lastFiredAt;
    case "silenced":
      return silence?.startsAt ?? null;
    case "inactive":
    case "paused":
      return null;
  }
}

function groupByDefinition(
  instances: InstanceRow[],
): Map<string, InstanceRow[]> {
  const byDefinition = new Map<string, InstanceRow[]>();
  for (const instance of instances) {
    const list = byDefinition.get(instance.alertDefinitionId);
    if (list) list.push(instance);
    else byDefinition.set(instance.alertDefinitionId, [instance]);
  }
  return byDefinition;
}

export type TriageInput = DeliverySource & {
  window: Window;
  /** Every live rule, in the order the inventory prints them. */
  definitions: DefinitionRow[];
  instances: InstanceRow[];
  values: InstanceValues;
};

/** Worst first. A rule we cannot evaluate outranks one that is firing: a
 *  missing verdict hides an unknown number of firing instances. */
const BAND_RANK: Record<TriageStatus, number> = {
  degraded: 0,
  firing: 1,
  pending: 2,
};

/** Worst first, which is the vocabulary read backwards: `ALERTING_SEVERITIES`
 *  is ascending, and it is the list the Zod and Postgres enums are built from,
 *  so a severity added there cannot fall out of this sort. */
const SEVERITY_RANK = Object.fromEntries(
  [...ALERTING_SEVERITIES].reverse().map((severity, rank) => [severity, rank]),
) as Record<AlertingSeverity, number>;

/** A silenced rule is still firing, so it stays in its own band, after the
 *  rest of it. Exiling it to the bottom would hide the fact that the thing
 *  you silenced is still happening. */
export function byTriageOrder(a: TriageAlert, b: TriageAlert): number {
  return (
    BAND_RANK[a.status] - BAND_RANK[b.status] ||
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    Number(Boolean(a.silence)) - Number(Boolean(b.silence))
  );
}

export function assembleTriage(input: TriageInput): AlertTriageData {
  const { now } = input;
  const window = chartWindow(input.window);
  const byDefinition = groupByDefinition(input.instances);

  const alerts: TriageAlert[] = [];
  const rules: RuleInventoryRow[] = [];

  for (const row of input.definitions) {
    const path = rulePath(row);
    const own = byDefinition.get(row.id) ?? [];
    const delivery = deliveryFor(row, input);
    const { silence } = delivery;

    rules.push({
      path,
      name: ruleTitle(row),
      severity: row.spec.severity,
      state: inventoryState(row, silence !== null),
      every: formatDurationSeconds(row.spec.interval_secs),
      // A paused rule has no silence to report: it is off, not muted.
      silence:
        row.active && silence
          ? `${formatElapsed(silence.endsAt.getTime() - now.getTime())} left`
          : null,
    });

    const status = triageStatus(row);
    if (status === null) continue;

    const worst = worstInstance(own);
    const pendingFor = row.spec.for_secs * 1000;
    const pendingElapsed = worst?.pendingSince
      ? now.getTime() - worst.pendingSince.getTime()
      : 0;

    alerts.push({
      path,
      name: ruleTitle(row),
      severity: row.spec.severity,
      status,
      measured: measuredText(row, own),
      notification: notificationText(row, delivery, now),
      value: status === "degraded" ? null : formatValue(worst?.value ?? null),
      condition: conditionText(row.spec),
      since: formatSince(stateSince(status, row, worst, silence), now),
      ...(status === "pending" && pendingFor > 0
        ? {
            pending: {
              total: formatDurationSeconds(row.spec.for_secs),
              percent: Math.min(
                100,
                Math.round((pendingElapsed / pendingFor) * 100),
              ),
            },
          }
        : {}),
      ...(row.lastError && status === "degraded"
        ? { error: row.lastError }
        : {}),
      ...(silence ? { silence: silenceView(silence, now, delivery.held) } : {}),
      instances: own.length,
      spark: {
        instances: (input.values.byPath.get(path) ?? NO_LANES).lanes,
        window,
      },
    });
  }

  // Stable, and the definitions arrived in label order, so ties keep it.
  return { alerts: alerts.sort(byTriageOrder), rules };
}

export type RuleStateHistoryInput = {
  now: Date;
  window: Window;
  definitions: DefinitionRow[];
  /** Silences whose window covers `now`. */
  silences: SilenceRow[];
  /** Every live rule's lifecycle events inside the window. */
  events: LifecycleEventRow[];
  /** The last transition each instance made before the window opened. */
  prior: PriorStateRow[];
  values: InstanceValues;
};

export function assembleRuleStateHistory(
  input: RuleStateHistoryInput,
): RuleStateHistoryData {
  const windowFrom = input.window.from.getTime();
  const windowTo = input.window.to.getTime();

  const byRule = new Map<string, LifecycleRow[]>();
  for (const row of input.events) {
    // A stamp that will not parse is dropped, not back-dated: an event placed
    // at the epoch would paint a segment across the whole window.
    const at = parseTimestampAsUTC(row.event_time);
    if (!at) continue;
    const list = byRule.get(row.slug) ?? [];
    list.push({
      fingerprint: row.instance_fingerprint,
      eventType: row.event_type,
      at: at.getTime(),
    });
    byRule.set(row.slug, list);
  }

  const priorByRule = new Map<string, LifecycleRow[]>();
  for (const row of input.prior) {
    const list = priorByRule.get(row.slug) ?? [];
    list.push({
      fingerprint: row.instance_fingerprint,
      eventType: row.last_event_type,
      // Everything before the window collapses to its edge: only which state
      // the instance was left in matters, not when it got there.
      at: windowFrom,
    });
    priorByRule.set(row.slug, list);
  }

  const rules: Record<string, RuleStateHistory> = {};
  for (const definition of input.definitions) {
    const path = rulePath(definition);
    const silence = silenceFor(
      definition.id,
      definition.spec.severity,
      input.silences,
      input.now,
    );
    rules[path] = {
      instances: (input.values.byPath.get(path) ?? NO_LANES).lanes,
      segments: ruleStateSegments({
        rows: byRule.get(path) ?? [],
        prior: priorByRule.get(path) ?? [],
        windowFrom,
        windowTo,
        intervalMs: definition.spec.interval_secs * 1000,
        silencedFrom: silence ? silence.startsAt.getTime() : null,
      }),
    };
  }
  return { window: chartWindow(input.window), rules };
}

export type AlertDetailInput = DeliverySource & {
  window: Window;
  definition: DefinitionRow;
  /** The rule's instances, highest value first. */
  instances: InstanceRow[];
  /** Silences for this rule whose window overlaps the queried one. */
  windowSilences: SilenceRow[];
  silenceImpacts: Map<string, SilenceImpactCounts>;
  /** The rule's most recent lifecycle rows, newest first. */
  timeline: TimelineRow[];
  /** The last evaluation's sample set. */
  lastSamples: AlertingEvaluationSample[];
  values: InstanceValues;
};

/**
 * How long a pause has been in force and who put it there, as
 * "since 14m by Ada". The state word beside it already says the rule is
 * paused, so the line adds only the trail. Rules paused before the trail
 * columns existed carry none, and say nothing rather than guess.
 */
function pauseTrail(definition: DefinitionRow, now: Date): string {
  const when = formatSincePhrase(definition.pausedAt, now);
  if (!when) return "";
  const who = definition.pausedBy?.trim();
  return who ? `${when} by ${who}` : when;
}

/**
 * What the state means for delivery, as the one phrase printed beside it.
 * Silenced rules keep evaluating, which is the difference from a pause that
 * readers ask about; a paused rule prints its trail instead, because nothing
 * about delivery is left to say.
 */
function detailNotification(
  status: RuleInventoryState,
  delivery: string,
): string {
  if (status === "silenced") return `${delivery} · rule keeps evaluating`;
  return delivery;
}

export function assembleAlertDetail(input: AlertDetailInput): AlertDetail {
  const { now, definition } = input;
  const spec = definition.spec;
  const path = rulePath(definition);
  const delivery = deliveryFor(definition, input);
  const { silence } = delivery;
  const status = inventoryState(definition, silence !== null);
  const worst = worstInstance(input.instances);
  const lanes = input.values.byPath.get(path) ?? NO_LANES;

  // A row whose stamp will not parse keeps its line and loses its clock: the
  // event still happened, and an epoch time would claim it happened in 1970.
  const timeline: LifecycleEvent[] = input.timeline.map((row, index) => {
    const at = parseTimestampAsUTC(row.event_time);
    return {
      time: at ? formatClock(at) : null,
      text: lifecycleLine(row),
      ...(index === 0 ? { current: true } : {}),
    };
  });

  const runbookLink = spec.annotations?.[ANN_ALERTING_LINK_RUNBOOK]?.trim();

  return {
    path,
    name: ruleTitle(definition),
    severity: spec.severity,
    status,
    since: formatSince(stateSince(status, definition, worst, silence), now),
    condition: conditionText(spec),
    description:
      spec.annotations?.[ANN_DISPLAY_DESCRIPTION]?.trim() ||
      "This rule declares no description.",
    notification:
      status === "paused"
        ? pauseTrail(definition, now)
        : detailNotification(
            status,
            notificationText(definition, delivery, now),
          ),
    threshold: spec.condition.threshold,
    window: chartWindow(input.window),
    instanceValues: lanes.lanes,
    hiddenInstanceValues: lanes.hidden,
    bucketMinutes: input.values.bucketMs / 60_000,
    intervalMinutes: spec.interval_secs / 60,
    instanceSummary: instanceSummary(input.instances, input.lastSamples),
    timeline,
    definition: {
      repository: definition.repoid,
      project: definition.project,
      runbook: runbookLink
        ? { href: runbookLink, label: runbookLabel(runbookLink) }
        : null,
      evaluationInterval: formatDurationSeconds(spec.interval_secs),
      notificationTitle: spec.annotations?.[ANN_ALERTING_SUMMARY] ?? "",
      notificationDescription:
        spec.annotations?.[ANN_ALERTING_DESCRIPTION] ?? "",
      lastEvaluatedAt: definition.lastSeenAt?.toISOString() ?? null,
      query: spec.sql,
    },
    silences: silenceRecords(input.windowSilences, now, input.silenceImpacts),
    activeSilenceId: silence?.id ?? null,
    forClause: formatDurationSeconds(spec.for_secs),
  };
}
