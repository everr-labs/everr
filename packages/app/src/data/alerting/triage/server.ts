/**
 * The triage screen's reads: the board, the state history behind the
 * inventory, and one rule's detail. Each loads from the rule rows, the
 * silences, the notification journal and the ClickHouse history, which the
 * modules beside this one own, and hands the rows to `assemble.ts`, which owns
 * what they mean.
 */
import { resolveTimeRange } from "@everr/ui/lib/time-range";
import * as z from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  assembleAlertDetail,
  assembleRuleStateHistory,
  assembleTriage,
} from "./assemble";
import { formatLabels } from "./format";
import {
  loadInstanceLabels,
  loadInstanceValues,
  loadLastEvaluation,
  loadLifecycleEvents,
  loadPriorStates,
  loadRecentTimeline,
  loadSilenceImpact,
  parseSamples,
  type ValueRule,
} from "./history";
import {
  loadDefaultTiers,
  loadHeldCounts,
  loadLatestNotifications,
} from "./notifications";
import {
  type DefinitionRow,
  loadInstances,
  loadRule,
  loadRuleInstances,
  loadRules,
  rulePath,
  triageStatus,
} from "./rules";
import { loadActiveSilences, loadSilencesInWindow } from "./silences";
import type {
  AlertDetail,
  AlertTriageData,
  RuleStateHistoryData,
} from "./view";

const valueRule = (row: DefinitionRow): ValueRule => ({
  path: rulePath(row),
  condition: row.spec.condition,
  intervalSecs: row.spec.interval_secs,
});

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
    const { fromDate, toDate } = resolveTimeRange(data);

    const definitions = await loadRules(organizationId);
    const ids = definitions.map((d) => d.id);
    const triageDefinitions = definitions.filter(
      (d) => triageStatus(d) !== null,
    );
    const [instances, silences, notifications, held, defaultTiers, values] =
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
          rules: triageDefinitions.map(valueRule),
          from: fromDate,
          to: toDate,
        }),
      ]);

    return assembleTriage({
      now,
      window: { from: fromDate, to: toDate },
      definitions,
      instances,
      silences,
      notifications,
      held,
      defaultTiers,
      values,
    });
  });

export const getRuleStateHistory = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data, context }): Promise<RuleStateHistoryData> => {
    const organizationId = context.session.session.activeOrganizationId;
    const { fromDate, toDate, fromISO, toISO } = resolveTimeRange(data);

    const [definitions, silences, events, prior] = await Promise.all([
      loadRules(organizationId),
      loadActiveSilences(organizationId),
      loadLifecycleEvents(context.clickhouse.query, { fromISO, toISO }),
      loadPriorStates(context.clickhouse.query, { fromDate, fromISO }),
    ]);

    // The values behind the states, for the same window and the same rules:
    // the list's tooltip names the instances, and a chart that can only say
    // "firing" sends the reader to the detail panel to learn on what.
    const values = await loadInstanceValues(context.clickhouse.query, {
      rules: definitions.map(valueRule),
      from: fromDate,
      to: toDate,
    });

    return assembleRuleStateHistory({
      now: new Date(),
      window: { from: fromDate, to: toDate },
      definitions,
      silences,
      events,
      prior,
      values,
    });
  });

export const getAlertDetail = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({ path: z.string(), from: z.string(), to: z.string() }),
  )
  .handler(async ({ data, context }): Promise<AlertDetail> => {
    const organizationId = context.session.session.activeOrganizationId;
    const now = new Date();
    const { fromDate, toDate } = resolveTimeRange(data);

    const definition = await loadRule(organizationId, data.path);
    const path = rulePath(definition);
    const spec = definition.spec;

    const [
      instances,
      silences,
      windowSilences,
      notifications,
      held,
      defaultTiers,
      timeline,
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

    const lastSamples = parseSamples(lastEvaluation[0]?.samples_json ?? "[]");
    const silenceImpacts = await loadSilenceImpact(
      context.clickhouse.query,
      windowSilences,
    );
    const values = await loadInstanceValues(context.clickhouse.query, {
      rules: [valueRule(definition)],
      from: fromDate,
      to: toDate,
      // The chart names its lanes, and a fingerprint is not a name: instances
      // that have since closed are named from the window's rows, and the ones
      // the last evaluation saw from its own samples.
      labels: new Map([
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
    });

    return assembleAlertDetail({
      now,
      window: { from: fromDate, to: toDate },
      definition,
      instances,
      silences,
      windowSilences,
      silenceImpacts,
      notifications,
      held,
      defaultTiers,
      timeline,
      lastSamples,
      values,
    });
  });
