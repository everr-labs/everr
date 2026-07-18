import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  queryAlertEventLog,
  queryObservedLabelKeys,
  queryObservedLabelValues,
} from "@/data/alerts/history.server";
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import * as cc from "./client";
import {
  CcChannelConfigSchema,
  CcInhibitionInputSchema,
  CcRouteInputSchema,
  CcRuleHealthStatusSchema,
  CcRuleSpecSchema,
  CcSilenceInputSchema,
} from "./schema";
import { ccSloTiers } from "./slo";
import {
  CC_SLO_RESERVED_LABEL_KEYS,
  CC_SYNTHETIC_LABEL_KEYS,
  CC_SYNTHETIC_LABEL_VALUES,
} from "./synthetic-labels";

const orgId = (session: { session: { activeOrganizationId: string } }) =>
  session.session.activeOrganizationId;

// Client-side query definitions (keys, poll cadence) for these server fns
// live in ./queries.ts.

// ---- Queries ----
// The full rule set, walked page by page (CC's bare-array listing mode is
// gone). For surfaces that resolve every rule at once (triage, history).
export const listCcRules = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listAllRules(orgId(session)));

// One page of the rules listing (CC's {items, next_cursor} envelope) with an
// optional server-side health filter, for the paginated rules table.
export const listCcRulesPage = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(500).default(100),
      cursor: z.string().optional(),
      health: CcRuleHealthStatusSchema.optional(),
    }),
  )
  .handler(({ data, context: { session } }) =>
    cc.listRulesPage(orgId(session), data),
  );

export const getCcRule = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    cc.getRule(orgId(session), ruleId),
  );

export const listCcAlerts = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listAlerts(orgId(session)));

export const listCcSlos = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listSlos(orgId(session)));

export const getCcSlo = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    cc.getSlo(orgId(session), sloId),
  );

// The evaluator's latest status snapshot; null until the first evaluation
// tick writes one (the detail page's pending state).
export const getCcSloStatus = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    cc.getSloStatus(orgId(session), sloId),
  );

export const listCcChannels = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listChannels(orgId(session)));

export const listCcReceivers = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listReceivers(orgId(session)));

export const listCcRoutes = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listRoutes(orgId(session)));

export const listCcInhibitions = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listInhibitions(orgId(session)));

export const listCcSilences = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listSilences(orgId(session)));

export const listCcSubscriptions = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listSubscriptions(orgId(session)));

// Stored CC event history (all rules, all event types) from ClickHouse app.logs.
// Tenancy rides on the org-scoped clickhouse context (row-level policy), not on a
// SQL organization filter. Backs the event history feed.
export const listCcEventHistory = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(500).default(200),
      timeRange: TimeRangeSchema,
      // Narrow to one alert instance's events (server-side WHERE), for the
      // triage board's expanded-row detail.
      fingerprint: z.string().min(1).optional(),
    }),
  )
  .handler(
    ({ data: { limit, timeRange, fingerprint }, context: { clickhouse } }) => {
      const { fromISO, toISO } = resolveTimeRange(timeRange);
      return queryAlertEventLog(clickhouse.query, {
        limit,
        fromISO,
        toISO,
        ...(fingerprint !== undefined ? { fingerprint } : {}),
      });
    },
  );

// ---- Label suggestions ----
// What the matcher/label comboboxes offer. Sources are merged best-effort
// (Promise.allSettled): suggestions assist typing and must never fail or block
// it, so a source that errors just drops out of the list.

/** Bounded lookback for observed keys/values; matchers outlive instances. */
const SUGGESTION_WINDOW = { from: "now-7d", to: "now" } as const;
const SUGGESTION_LIMIT = 100;

export type CcLabelKeySuggestion = { key: string; synthetic: boolean };
export type CcLabelValueSuggestion = { value: string; hint?: string };

const settled = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
  r.status === "fulfilled" ? r.value : fallback;

/**
 * Every label key a matcher could usefully name: the dispatcher's synthetic
 * keys first, then the SLO pipeline's reserved keys (both flagged, so the UI
 * can teach that they exist), then keys alerts have actually carried — stored
 * event history (frequency order), the rules' and SLOs' declared
 * label_columns, and current instances' labels.
 */
export const listCcLabelKeys = createAuthenticatedServerFn({
  method: "GET",
}).handler(
  async ({
    context: { session, clickhouse },
  }): Promise<CcLabelKeySuggestion[]> => {
    const { fromISO, toISO } = resolveTimeRange(SUGGESTION_WINDOW);
    const [observed, rules, slos, alerts] = await Promise.allSettled([
      queryObservedLabelKeys(clickhouse.query, {
        limit: SUGGESTION_LIMIT,
        fromISO,
        toISO,
      }),
      cc.listAllRules(orgId(session)),
      cc.listSlos(orgId(session)),
      cc.listAlerts(orgId(session)),
    ]);
    const merged = new Set<string>(settled(observed, []));
    for (const rule of settled(rules, []))
      for (const key of rule.spec.label_columns) merged.add(key);
    for (const slo of settled(slos, []))
      for (const key of slo.spec.sli.label_columns) merged.add(key);
    for (const alert of settled(alerts, []))
      for (const key of Object.keys(alert.labels)) merged.add(key);
    // Engine-reserved keys win on collision at dispatch time (synthetics
    // clobber, slo/slo_tier are rejected as label columns), so they win here.
    const reserved = [
      ...CC_SYNTHETIC_LABEL_KEYS,
      ...CC_SLO_RESERVED_LABEL_KEYS,
    ];
    for (const key of reserved) merged.delete(key);
    return [
      ...reserved.map((key) => ({ key, synthetic: true })),
      ...[...merged]
        .slice(0, SUGGESTION_LIMIT)
        .map((key) => ({ key, synthetic: false })),
    ];
  },
);

/**
 * The values one label key has carried. Synthetic keys answer with the
 * engine's own vocabulary — severity/status/kind enums; for `rule` the rule
 * IDs the dispatcher actually matches on (dispatcher/routing.rs inserts
 * `rule` as the RuleId), with the friendly name as a secondary hint; for
 * `slo` the SLO ids the dispatcher stamps on SLO-originated events (name as
 * hint); for `slo_tier` the tier names across the tenant's SLOs (explicit
 * spec tiers, canonical when unset). Other keys merge current instances'
 * labels with stored event history.
 */
export const listCcLabelValues = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ key: z.string().min(1) }))
  .handler(
    async ({
      data: { key },
      context: { session, clickhouse },
    }): Promise<CcLabelValueSuggestion[]> => {
      const staticValues =
        CC_SYNTHETIC_LABEL_VALUES[
          key as keyof typeof CC_SYNTHETIC_LABEL_VALUES
        ];
      if (staticValues) return staticValues.map((value) => ({ value }));
      switch (key) {
        case "rule": {
          const rules = await cc.listAllRules(orgId(session)).catch(() => []);
          return rules.map((rule) => ({
            value: rule.id,
            hint: ccRuleIdentity(rule).name,
          }));
        }
        case "slo": {
          const slos = await cc.listSlos(orgId(session)).catch(() => []);
          return slos.map((slo) => ({ value: slo.id, hint: slo.name }));
        }
        case "slo_tier": {
          const slos = await cc.listSlos(orgId(session)).catch(() => []);
          const names = new Set<string>();
          for (const slo of slos)
            for (const tier of ccSloTiers(slo.spec)) names.add(tier.name);
          return [...names].map((value) => ({ value }));
        }
        default: {
          const { fromISO, toISO } = resolveTimeRange(SUGGESTION_WINDOW);
          const [alerts, observed] = await Promise.allSettled([
            cc.listAlerts(orgId(session)),
            queryObservedLabelValues(clickhouse.query, key, {
              limit: SUGGESTION_LIMIT,
              fromISO,
              toISO,
            }),
          ]);
          const merged = new Set<string>();
          for (const alert of settled(alerts, [])) {
            const value = alert.labels[key];
            if (value) merged.add(value);
          }
          for (const value of settled(observed, [])) merged.add(value);
          return [...merged]
            .slice(0, SUGGESTION_LIMIT)
            .map((value) => ({ value }));
        }
      }
    },
  );

// ---- Rule operations ----
export const pauseCcRule = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    cc.pauseRule(orgId(session), ruleId),
  );

export const resumeCcRule = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    cc.resumeRule(orgId(session), ruleId),
  );

export const testCcRule = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ ruleId: z.string(), spec: CcRuleSpecSchema }))
  .handler(({ data: { ruleId, spec }, context: { session } }) =>
    cc.testRule(orgId(session), ruleId, spec),
  );

// ---- SLO operations ----
export const pauseCcSlo = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    cc.pauseSlo(orgId(session), sloId),
  );

export const resumeCcSlo = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    cc.resumeSlo(orgId(session), sloId),
  );

export const deleteCcSlo = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    cc.deleteSlo(orgId(session), sloId),
  );

// ---- Channels ----
// CC's POST /v1/channels is an upsert by name; the UI guards against
// clobbering an existing channel by checking the listed names client-side.
export const createCcChannel = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      config: CcChannelConfigSchema,
    }),
  )
  .handler(({ data, context: { session } }) =>
    cc.upsertChannel(orgId(session), data),
  );

// CC refuses to delete a referenced channel: a 409 whose message names the
// referring receivers, surfaced verbatim in the UI toast.
export const deleteCcChannel = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ name: z.string().min(1) }))
  .handler(({ data: { name }, context: { session } }) =>
    cc.deleteChannel(orgId(session), name),
  );

// ---- Receivers ----
// CC's POST /v1/receivers is an upsert by name; the UI guards against
// clobbering an existing receiver by checking the listed names client-side.
// `channels` is a list of channel NAMES; the engine 422s unknown ones.
export const createCcReceiver = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      channels: z.array(z.string().min(1)).min(1),
    }),
  )
  .handler(({ data, context: { session } }) =>
    cc.upsertReceiver(orgId(session), data),
  );

export const deleteCcReceiver = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ name: z.string().min(1) }))
  .handler(({ data: { name }, context: { session } }) =>
    cc.deleteReceiver(orgId(session), name),
  );

// ---- Routes ----
export const createCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(CcRouteInputSchema)
  .handler(({ data, context: { session } }) =>
    cc.createRoute(orgId(session), data),
  );

export const updateCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), input: CcRouteInputSchema }))
  .handler(({ data: { id, input }, context: { session } }) =>
    cc.updateRoute(orgId(session), id, input),
  );

export const deleteCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    cc.deleteRoute(orgId(session), id),
  );

// ---- Inhibitions ----
export const createCcInhibition = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(CcInhibitionInputSchema)
  .handler(({ data, context: { session } }) =>
    cc.createInhibition(orgId(session), data),
  );

export const deleteCcInhibition = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    cc.deleteInhibition(orgId(session), id),
  );

// ---- Silences ----
export const createCcSilence = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(CcSilenceInputSchema)
  .handler(({ data, context: { session } }) =>
    cc.createSilence(orgId(session), data),
  );

export const deleteCcSilence = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    cc.deleteSilence(orgId(session), id),
  );

// ---- Subscriptions ----
export const createCcSubscription = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ webhookUrl: z.url() }))
  .handler(({ data: { webhookUrl }, context: { session } }) =>
    cc.createSubscription(orgId(session), webhookUrl),
  );

export const deleteCcSubscription = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    cc.deleteSubscription(orgId(session), id),
  );
