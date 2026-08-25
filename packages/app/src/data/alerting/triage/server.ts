/**
 * The triage screen's reads: the board, the state history behind the
 * inventory, and one rule's detail. Each assembles a view from the rule rows,
 * the silences, the notification journal and the ClickHouse history, and the
 * modules beside this one own each of those.
 */
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import * as z from "zod";
import {
  ANN_ALERTING_DESCRIPTION,
  ANN_ALERTING_LINK_RUNBOOK,
  ANN_ALERTING_SUMMARY,
  ANN_DISPLAY_DESCRIPTION,
} from "@/data/alerting/resource-annotations";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  formatClock,
  formatElapsed,
  formatLabels,
  formatSince,
  formatValue,
} from "./format";
import {
  buildInstanceValues,
  lifecycleLine,
  loadInstanceLabels,
  loadInstanceValues,
  loadLastEvaluation,
  loadLifecycleEvents,
  loadPriorStates,
  loadRecentTimeline,
  loadSilenceImpact,
  parseSamples,
} from "./history";
import {
  hasDeliveryTarget,
  loadDefaultTiers,
  loadHeldCounts,
  loadLatestNotifications,
  notificationText,
} from "./notifications";
import {
  conditionText,
  type InstanceRow,
  instanceSummary,
  inventoryState,
  loadInstances,
  loadRule,
  loadRuleInstances,
  loadRules,
  measuredText,
  rulePath,
  ruleTitle,
  runbookLabel,
  triageStatus,
  worstInstance,
} from "./rules";
import { type LifecycleRow, ruleStateSegments } from "./segments";
import {
  loadActiveSilences,
  loadSilencesInWindow,
  silenceFor,
  silenceRecord,
  silenceView,
} from "./silences";
import type {
  AlertDetail,
  LifecycleEvent,
  RuleInventoryRow,
  RuleStateHistory,
  TriageAlert,
} from "./view";

type AlertTriageData = {
  alerts: TriageAlert[];
  rules: RuleInventoryRow[];
};

export const getAlertTriage = createAuthenticatedServerFn({
  method: "GET",
})
  // The row sparkline reads the same window as the two charts beside it. A
  // fixed hour here meant the row and the lane under it disagreed about what
  // the rule measured the moment the reader moved the picker.
  .inputValidator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data, context }): Promise<AlertTriageData> => {
    const organizationId = context.session.session.activeOrganizationId;
    const now = new Date();
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(data);
    const sparkWindowMs = toDate.getTime() - fromDate.getTime();
    const sparkWindowMinutes = sparkWindowMs / 60_000;

    const definitions = await loadRules(organizationId);
    const ids = definitions.map((d) => d.id);
    const triageDefinitions = definitions.filter(
      (d) => triageStatus(d) !== null,
    );
    const [instances, silences, notifications, held, defaultTiers, sparks] =
      await Promise.all([
        loadInstances(organizationId, ids),
        loadActiveSilences(organizationId),
        loadLatestNotifications(organizationId, ids),
        loadHeldCounts(organizationId, ids),
        loadDefaultTiers(organizationId),
        // The same per-instance values the two charts on this screen read, over
        // the same selected window: one loader, so a row, a lane and a track can
        // never disagree about what the rule measured. It rides here rather than
        // after the await because it is the one ClickHouse read in the set, and
        // so is the one that genuinely overlaps the five PostgreSQL ones.
        loadInstanceValues(context.clickhouse.query, {
          paths: triageDefinitions.map(rulePath),
          fromISO,
          toISO,
          windowMs: sparkWindowMs,
          intervalMs: Math.min(
            ...triageDefinitions.map((d) => d.spec.interval_secs * 1000),
            60_000,
          ),
        }),
      ]);

    const byDefinition = new Map<string, InstanceRow[]>();
    for (const instance of instances) {
      const list = byDefinition.get(instance.alertDefinitionId);
      if (list) list.push(instance);
      else byDefinition.set(instance.alertDefinitionId, [instance]);
    }

    const alerts: TriageAlert[] = [];
    const rules: RuleInventoryRow[] = [];

    for (const row of definitions) {
      const path = rulePath(row);
      const own = byDefinition.get(row.id) ?? [];
      const silenceRow = silenceFor(path, row.spec.severity, silences, now);
      const heldCount = held.get(row.id) ?? 0;

      rules.push({
        path,
        name: ruleTitle(row),
        severity: row.spec.severity,
        state: inventoryState(row, silenceRow !== null),
        every: formatDurationSeconds(row.spec.interval_secs),
        // A paused rule has no silence to report: it is off, not muted.
        silence:
          row.active && silenceRow
            ? `${formatElapsed(silenceRow.endsAt.getTime() - now.getTime())} left`
            : null,
      });

      const status = triageStatus(row);
      if (status === null) continue;

      const worst = worstInstance(own);
      const sinceAt =
        status === "degraded"
          ? row.degradedSince
          : status === "pending"
            ? (worst?.pendingSince ?? null)
            : (worst?.activeSince ?? row.lastFiredAt);

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
        notification: notificationText(
          row,
          notifications.get(row.id),
          silenceRow,
          heldCount,
          hasDeliveryTarget(row, defaultTiers),
          now,
        ),
        value: status === "degraded" ? null : formatValue(worst?.value ?? null),
        condition: conditionText(row.spec),
        since: formatSince(sinceAt, now),
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
        ...(silenceRow
          ? { silence: silenceView(silenceRow, now, heldCount) }
          : {}),
        instances: own.length,
        spark: {
          instances: buildInstanceValues({
            buckets: sparks.buckets.get(path) ?? new Map(),
            labels: sparks.labels,
            windowTo: toDate.getTime(),
            condition: row.spec.condition,
          }).lanes,
          windowMinutes: sparkWindowMinutes,
          endsAt: toDate.getTime(),
        },
      });
    }

    return { alerts, rules };
  });

export const getRuleStateHistory = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ from: z.string(), to: z.string() }))
  .handler(
    async ({ data, context }): Promise<Record<string, RuleStateHistory>> => {
      const organizationId = context.session.session.activeOrganizationId;
      const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(data);

      const [definitions, silences, rows, priorRows] = await Promise.all([
        loadRules(organizationId),
        loadActiveSilences(organizationId),
        loadLifecycleEvents(context.clickhouse.query, { fromISO, toISO }),
        loadPriorStates(context.clickhouse.query, { fromDate, fromISO }),
      ]);

      const byRule = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = byRule.get(row.slug);
        if (list) list.push(row);
        else byRule.set(row.slug, [row]);
      }

      const priorByRule = new Map<string, LifecycleRow[]>();
      for (const row of priorRows) {
        const list = priorByRule.get(row.slug) ?? [];
        list.push({
          fingerprint: row.instance_fingerprint,
          eventType: row.last_event_type,
          // Everything before the window collapses to its edge: only which
          // state the instance was left in matters, not when it got there.
          at: fromDate.getTime(),
        });
        priorByRule.set(row.slug, list);
      }

      // The values behind the states, for the same window and the same rules:
      // the list's tooltip names the instances, and a chart that can only say
      // "firing" sends the reader to the detail panel to learn on what.
      const values = await loadInstanceValues(context.clickhouse.query, {
        paths: definitions.map((definition) => rulePath(definition)),
        fromISO,
        toISO,
        windowMs: toDate.getTime() - fromDate.getTime(),
        intervalMs: Math.min(
          ...definitions.map((d) => d.spec.interval_secs * 1000),
          60_000,
        ),
      });

      const now = new Date();
      const out: Record<string, RuleStateHistory> = {};
      for (const definition of definitions) {
        const path = rulePath(definition);
        const silence = silenceFor(
          path,
          definition.spec.severity,
          silences,
          now,
        );
        out[path] = {
          instances: buildInstanceValues({
            buckets: values.buckets.get(path) ?? new Map(),
            labels: values.labels,
            windowTo: toDate.getTime(),
            condition: definition.spec.condition,
          }).lanes,
          segments: ruleStateSegments({
            // A stamp that will not parse is dropped, not back-dated: an
            // event placed at the epoch would paint a segment across the
            // whole window.
            rows: (byRule.get(path) ?? []).flatMap((r) => {
              const at = parseTimestampAsUTC(r.event_time);
              return at
                ? [
                    {
                      fingerprint: r.instance_fingerprint,
                      eventType: r.event_type,
                      at: at.getTime(),
                    },
                  ]
                : [];
            }),
            prior: priorByRule.get(path) ?? [],
            windowFrom: fromDate.getTime(),
            windowTo: toDate.getTime(),
            intervalMs: definition.spec.interval_secs * 1000,
            silencedFrom: silence ? silence.startsAt.getTime() : null,
          }),
        };
      }
      return out;
    },
  );

export const getAlertDetail = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      project: z.string(),
      slug: z.string(),
      from: z.string(),
      to: z.string(),
    }),
  )
  .handler(async ({ data, context }): Promise<AlertDetail> => {
    const organizationId = context.session.session.activeOrganizationId;
    const now = new Date();
    const { fromDate, toDate } = resolveTimeRange({
      from: data.from,
      to: data.to,
    });

    const definition = await loadRule(organizationId, data.project, data.slug);
    const path = rulePath(definition);
    const spec = definition.spec;

    const [
      instances,
      silences,
      windowSilences,
      notifications,
      held,
      defaultTiers,
      history,
      lastEvaluation,
      instanceLabels,
    ] = await Promise.all([
      loadRuleInstances(organizationId, definition.id),
      loadActiveSilences(organizationId),
      loadSilencesInWindow(
        organizationId,
        path,
        spec.severity,
        fromDate,
        toDate,
      ),
      loadLatestNotifications(organizationId, [definition.id]),
      loadHeldCounts(organizationId, [definition.id]),
      loadDefaultTiers(organizationId),
      loadRecentTimeline(context.clickhouse.query, {
        path,
        windowTo: toDate,
      }),
      loadLastEvaluation(context.clickhouse.query, {
        path,
        windowFrom: fromDate,
        windowTo: toDate,
        intervalSecs: spec.interval_secs,
      }),
      loadInstanceLabels(context.clickhouse.query, {
        path,
        windowFrom: fromDate,
        windowTo: toDate,
      }),
    ]);

    const silenceRow = silenceFor(path, spec.severity, silences, now);
    const silenceImpacts = await loadSilenceImpact(
      context.clickhouse.query,
      windowSilences,
    );
    const values = await loadInstanceValues(context.clickhouse.query, {
      paths: [path],
      fromISO: fromDate.toISOString(),
      toISO: toDate.toISOString(),
      windowMs: toDate.getTime() - fromDate.getTime(),
      intervalMs: spec.interval_secs * 1000,
    });
    const lastSamples = parseSamples(lastEvaluation[0]?.samples_json ?? "[]");
    const instanceValues = buildInstanceValues({
      buckets: values.buckets.get(path) ?? new Map(),
      labels: new Map([
        ...values.labels,
        ...instanceLabels.map(
          (row) =>
            [
              row.instance_fingerprint,
              formatLabels(row.instance_labels ?? {}),
            ] as const,
        ),
        ...lastSamples.map(
          (sample) =>
            [sample.fingerprint, formatLabels(sample.labels ?? {})] as const,
        ),
      ]),
      windowTo: toDate.getTime(),
      condition: spec.condition,
    });
    const heldCount = held.get(definition.id) ?? 0;
    const status = inventoryState(definition, silenceRow !== null);
    const worst = worstInstance(instances);

    const since =
      status === "degraded"
        ? formatSince(definition.degradedSince, now)
        : status === "pending"
          ? formatSince(worst?.pendingSince ?? null, now)
          : status === "inactive"
            ? null
            : formatSince(worst?.activeSince ?? definition.lastFiredAt, now);

    // A row whose stamp will not parse keeps its line and loses its clock: the
    // event still happened, and an epoch time would claim it happened in 1970.
    const timeline: LifecycleEvent[] = history.map((row, index) => {
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
      since,
      condition: conditionText(spec),
      description:
        spec.annotations?.[ANN_DISPLAY_DESCRIPTION]?.trim() ||
        "This rule declares no description.",
      notification: notificationText(
        definition,
        notifications.get(definition.id),
        silenceRow,
        heldCount,
        hasDeliveryTarget(definition, defaultTiers),
        now,
      ),
      threshold: spec.condition.threshold,
      instanceValues: instanceValues.lanes,
      hiddenInstanceValues: instanceValues.hidden,
      bucketMinutes: values.bucketMs / 60_000,
      intervalMinutes: spec.interval_secs / 60,
      instanceSummary: instanceSummary(instances, lastSamples),
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
      silences: windowSilences.map((row) =>
        silenceRecord(
          row,
          now,
          silenceImpacts.get(row.id) ?? { held: 0, dropped: 0 },
        ),
      ),
      activeSilenceId: silenceRow?.id ?? null,
      forClause: formatDurationSeconds(spec.for_secs),
      paused: !definition.active,
    };
  });
