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
  loadLastEvaluation,
  loadLifecycleEvents,
  loadPriorStates,
  loadRecentTimeline,
  loadSilenceImpact,
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
import {
  loadOpenSilences,
  loadSilencesForPage,
  loadSilencesInWindow,
  NO_IMPACT,
  silenceRecord,
} from "./silences";
import { loadInstanceValues, parseSamples, type ValueRule } from "./values";
import type {
  AlertDetail,
  AlertSilenceRecord,
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
        loadOpenSilences(organizationId),
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
      loadOpenSilences(organizationId),
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
      loadOpenSilences(organizationId),
      loadSilencesInWindow(
        organizationId,
        definition.id,
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
            [row.instance_fingerprint, formatLabels(row.labels ?? {})] as const,
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

export const getAlertSilences = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data, context }): Promise<AlertSilenceRecord[]> => {
    const organizationId = context.session.session.activeOrganizationId;
    const now = new Date();
    const { fromDate, toDate } = resolveTimeRange(data);

    const silences = await loadSilencesForPage(
      organizationId,
      fromDate,
      toDate,
    );
    const impacts = await loadSilenceImpact(context.clickhouse.query, silences);
    return silences.map((row) =>
      silenceRecord(row, now, impacts.get(row.id) ?? NO_IMPACT),
    );
  });

/** The rules a silence may be pointed at, for the dialog that opens with none
 *  to assume. Its own read: the list changes when rules are applied, not
 *  every time the silences page polls. */
export const getAlertRulePaths = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }): Promise<string[]> => {
  const definitions = await loadRules(
    context.session.session.activeOrganizationId,
  );
  return definitions.map(rulePath);
});
