import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  queryAlertEventLog,
  queryObservedLabelKeys,
  queryObservedLabelValues,
} from "@/data/alerts/history.server";
import { visibleRulesForPreview } from "@/data/alerts/preview-overlay";
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import {
  findByResourceName,
  formatResourceName,
} from "@/data/as-code/identity";
import { getPreviewScopes } from "@/data/previews/repoids";
import {
  visibleSlosForPreview,
  withAuthoredSloName,
} from "@/data/slos/preview-overlay";
import { type ClickhouseQuery, querySqlApi } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import * as cc from "./client";
import { CcApiError } from "./errors";
import {
  CcChannelConfigSchema,
  CcInhibitionInputSchema,
  CcRouteInputSchema,
  CcSilenceInputSchema,
} from "./schema";
import { CC_CANONICAL_SLO_TIERS, ccSloWindowSecs } from "./slo";
import { querySloBudgetNow, querySloBudgetSeries } from "./slo-series.server";
import {
  CC_SLO_RESERVED_LABEL_KEYS,
  CC_SYNTHETIC_LABEL_KEYS,
  CC_SYNTHETIC_LABEL_VALUES,
} from "./synthetic-labels";
import type { CcRuleView, CcSloView } from "./types";

const orgId = (session: { session: { activeOrganizationId: string } }) =>
  session.session.activeOrganizationId;

function createSloQuery(organizationId: string): ClickhouseQuery {
  return <T>(sql: string, params?: Record<string, unknown>) =>
    querySqlApi<T>(sql, organizationId, params);
}

// Client-side query definitions (keys, poll cadence) for these server fns
// live in ./queries.ts.

// ---- Queries ----
// The full rule set, walked page by page (CC's bare-array listing mode is
// gone). For surfaces that resolve every rule at once (triage, history).
export const listCcRules = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listAllRules(orgId(session)));

// One page of the rules listing (CC's {items, next_cursor} envelope), for the
// paginated rules table.
export const listCcRulesPage = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(500).default(100),
      cursor: z.string().optional(),
      preview: z.string().optional(),
    }),
  )
  .handler(async ({ data, context: { session } }) => {
    const org = orgId(session);
    const preview = data.preview?.trim() || null;
    if (preview === null) {
      // Live listing stays keyset-paginated, pinned to the live namespace so
      // suppressed preview rules never leak into the table.
      return cc.listRulesPage(org, {
        limit: data.limit,
        ...(data.cursor ? { cursor: data.cursor } : {}),
        namespace: "",
      });
    }
    // Preview: the overlay needs the full cross-namespace set plus the
    // preview's registry scopes (same resolution as getCcRuleByName), so
    // pagination collapses to a single page like the other preview surfaces.
    const [rules, scopes] = await Promise.all([
      cc.listAllRules(org),
      getPreviewScopes(org, preview),
    ]);
    return {
      items: visibleRulesForPreview(rules, scopes),
      next_cursor: null,
    };
  });

export const getCcRule = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    cc.getRule(orgId(session), ruleId),
  );

// The slug-addressed rule route resolves by first-class name instead of the
// CC uuid: list the namespace scope and match by parsed identity
// (findByResourceName), the same aliasing the listings use to render links,
// so legacy/engine-generated bare names resolve under "default" instead of
// 404ing. Live-only by default; with a preview selected, the scope is fetched
// across namespaces and resolved through the same live-vs-preview overlay the
// listings use, so a preview-only or changed rule opens its preview copy
// instead of the live row (or a 404).
export const getCcRuleByName = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      project: z.string(),
      slug: z.string(),
      preview: z.string().optional(),
    }),
  )
  .handler(async ({ data, context: { session } }) => {
    const org = orgId(session);
    const preview = data.preview?.trim() || null;
    let candidates: CcRuleView[];
    if (preview === null) {
      candidates = await cc.listAllRules(org, { namespace: "" });
    } else {
      const [rules, scopes] = await Promise.all([
        cc.listAllRules(org),
        getPreviewScopes(org, preview),
      ]);
      candidates = visibleRulesForPreview(rules, scopes);
    }
    const rule = findByResourceName(candidates, data.project, data.slug);
    if (!rule) {
      throw new CcApiError(
        404,
        "not_found",
        `Rule not found: ${formatResourceName(data.project, data.slug)}`,
      );
    }
    return rule;
  });

// CC's /v1/alerts returns every non-inactive instance for the tenant —
// including instances of suppressed preview rules/SLOs, which CC evaluates
// fully. Scope them here by resolving each instance's source id against the
// same live-vs-preview overlay the definition listings use: live-only by
// default, the selected preview's overlay otherwise. An instance whose source
// is not in the visible set (another preview's, or a just-deleted source) is
// dropped rather than leaked into the triage feed.
export const listCcAlerts = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = orgId(session);
    const preview = data?.preview?.trim() || null;
    const [alerts, rules, slos, scopes] = await Promise.all([
      cc.listAlerts(org),
      cc.listAllRules(org),
      cc.listSlos(org),
      preview === null ? null : getPreviewScopes(org, preview),
    ]);
    const visibleRuleIds = new Set(
      visibleRulesForPreview(rules, scopes).map((r) => r.id),
    );
    const visibleSloIds = new Set(
      visibleSlosForPreview(slos, scopes).map((s) => s.id),
    );
    return alerts.filter((a) =>
      a.slo !== undefined
        ? visibleSloIds.has(a.slo)
        : visibleRuleIds.has(a.rule),
    );
  });

export const listCcSlos = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = orgId(session);
    const preview = data?.preview?.trim() || null;
    const [slos, scopes] = await Promise.all([
      cc.listSlos(org),
      preview === null ? null : getPreviewScopes(org, preview),
    ]);
    return visibleSlosForPreview(slos, scopes);
  });

export const getCcSlo = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(async ({ data: { sloId }, context: { session } }) =>
    withAuthoredSloName(await cc.getSlo(orgId(session), sloId)),
  );

// The slug-addressed SLO route's analogue of getCcRuleByName: list the
// namespace scope, resolve by parsed identity (bare names read as "default"),
// live-only by default and overlay-resolved when a preview is selected (see
// getCcRuleByName). listSlos doesn't 404 on a miss, so no match throws the
// route's 404-equivalent here instead.
export const getCcSloByName = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      project: z.string(),
      slug: z.string(),
      preview: z.string().optional(),
    }),
  )
  .handler(async ({ data, context: { session } }) => {
    const org = orgId(session);
    const preview = data.preview?.trim() || null;
    let candidates: CcSloView[];
    if (preview === null) {
      candidates = await cc.listSlos(org, { namespace: "" });
    } else {
      const [slos, scopes] = await Promise.all([
        cc.listSlos(org),
        getPreviewScopes(org, preview),
      ]);
      candidates = visibleSlosForPreview(slos, scopes);
    }
    const slo = findByResourceName(candidates, data.project, data.slug);
    if (!slo) {
      throw new CcApiError(
        404,
        "not_found",
        `SLO not found: ${formatResourceName(data.project, data.slug)}`,
      );
    }
    return withAuthoredSloName(slo);
  });

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
      // Narrow to one source's rule handles (server-side WHERE), for scoped
      // feeds (rule/SLO detail): the tenant-wide newest-N window would let
      // other sources fill the cap and starve the scoped source.
      slugs: z.array(z.string().min(1)).min(1).optional(),
      // Preview-rule records are suppressed and stamped with the same
      // service.name as live ones, so the live feed filters them out. A
      // selected preview asks for them back.
      preview: z.string().optional(),
    }),
  )
  .handler(
    ({
      data: { limit, timeRange, fingerprint, slugs, preview },
      context: { clickhouse },
    }) => {
      const { fromISO, toISO } = resolveTimeRange(timeRange);
      return queryAlertEventLog(clickhouse.query, {
        limit,
        fromISO,
        toISO,
        includeSuppressed: (preview?.trim() ?? "") !== "",
        ...(fingerprint !== undefined ? { fingerprint } : {}),
        ...(slugs !== undefined ? { slugs } : {}),
      });
    },
  );

// The SLO's error-budget-over-time series, computed at read time by replaying
// the SLI over trailing windows against raw telemetry (slo-series.server.ts) —
// no stored samples, so a fresh SLO charts history as far back as retention. We
// fetch the SLO server-side for the authoritative SLI/target/window rather than
// trusting the client. The per-org SQL API user pins tenancy independently of
// the SLO's tenant-authored SQL and applies readonly resource limits.
export const getCcSloBudgetSeries = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      sloId: z.string().min(1),
      timeRange: TimeRangeSchema,
      points: z.number().int().min(2).max(200).default(60),
    }),
  )
  .handler(
    async ({ data: { sloId, timeRange, points }, context: { session } }) => {
      const org = orgId(session);
      const slo = await cc.getSlo(org, sloId);
      const windowSecs = ccSloWindowSecs(slo.spec);
      if (windowSecs === null) return [];
      const { fromISO, toISO } = resolveTimeRange(timeRange);

      // The recent edge runs to the range end ("now"): the status hero computes
      // its budget at read time too (getCcSloBudgetNow), so the chart and the
      // hero agree without capping the chart at the engine's throttled last eval.
      return querySloBudgetSeries(createSloQuery(org), {
        sliSql: slo.spec.sli.sql,
        labelColumns: slo.spec.sli.label_columns,
        targetPercent: slo.spec.targetPercent,
        windowSecs,
        fromISO,
        toISO,
        points,
      });
    },
  );

// One SLO's CURRENT error budget per group, computed at read time from a single
// SLI scan over the trailing window ending now (querySloBudgetNow). The status
// hero and each visible listing row use this to override the stored snapshot's
// throttled budget with a value as of page view; it's keyed per SLO client-side
// (ccQueries.sloBudgetNow) so list -> detail navigation reuses the cache. An SLO
// whose window shorthand doesn't parse returns []. The SLI runs as the hardened
// per-org SQL API user because its SQL is tenant-authored.
export const getCcSloBudgetNow = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ sloId: z.string().min(1) }))
  .handler(async ({ data: { sloId }, context: { session } }) => {
    const org = orgId(session);
    const slo = await cc.getSlo(org, sloId);
    const windowSecs = ccSloWindowSecs(slo.spec);
    if (windowSecs === null) return [];
    return querySloBudgetNow(createSloQuery(org), {
      sliSql: slo.spec.sli.sql,
      labelColumns: slo.spec.sli.label_columns,
      targetPercent: slo.spec.targetPercent,
      windowSecs,
      nowMs: Date.now(),
    });
  });

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
          // Every SLO evaluates the same fixed canonical tiers, so the tier
          // names are constant (no need to walk the tenant's SLOs).
          return CC_CANONICAL_SLO_TIERS.map((tier) => ({ value: tier.name }));
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

// SLOs are as-code resources: there is deliberately no delete server fn for
// the UI. Deletion happens by removing the document from the repo and
// re-applying (the resource admin calls cc.deleteSlo directly).

// ---- Channels ----
// CC's POST /v1/channels is create-only (409 on an existing name); the UI
// also blocks duplicates up front by checking the listed names client-side.
export const createCcChannel = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      config: CcChannelConfigSchema,
    }),
  )
  .handler(({ data, context: { session } }) =>
    cc.createChannel(orgId(session), data),
  );

// CC refuses to delete a referenced channel: a 409 whose message names the
// referring receivers, surfaced verbatim in the UI toast.
export const deleteCcChannel = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ name: z.string().min(1) }))
  .handler(({ data: { name }, context: { session } }) =>
    cc.deleteChannel(orgId(session), name),
  );

// Tests an unsaved channel config before it is created. An email config's `to`
// is replaced with the caller's own address (see emailTestConfigFor); every
// other kind forwards untouched.
export const testCcChannel = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ config: CcChannelConfigSchema }))
  .handler(({ data, context: { session } }) =>
    cc.testChannel(orgId(session), {
      config: cc.emailTestConfigFor(data.config, session.user.email),
    }),
  );

// ---- Receivers ----
// CC's POST /v1/receivers is create-only (409 on an existing name); the UI
// also blocks duplicates up front by checking the listed names client-side.
// `channels` is a list of channel NAMES; the engine 422s unknown ones.
export const createCcReceiver = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      channels: z.array(z.string().min(1)).min(1),
    }),
  )
  .handler(({ data, context: { session } }) =>
    cc.createReceiver(orgId(session), data),
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
