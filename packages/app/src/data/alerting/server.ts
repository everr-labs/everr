import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  queryPostgresAlertEventLog,
  queryPostgresObservedLabelKeys,
  queryPostgresObservedLabelValues,
} from "@/data/alerts/history.server";
import { visibleRulesForPreview } from "@/data/alerts/preview-overlay";
import { alertingRuleIdentity } from "@/data/alerts/rule-identity";
import {
  findByResourceName,
  formatResourceName,
} from "@/data/as-code/identity";
import { getPreviewScopes } from "@/data/previews/repoids";
import { visibleSlosForPreview } from "@/data/slos/preview-overlay";
import { type ClickhouseQuery, querySqlApi } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { emailTestConfigFor } from "./email-test-config";
import { AlertingError } from "./errors";
import * as alerting from "./repository";
import {
  AlertingChannelConfigSchema,
  AlertingInhibitionInputSchema,
  AlertingRouteInputSchema,
  AlertingSilenceInputSchema,
} from "./schema";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingSloIdentity,
  alertingSloWindowSecs,
} from "./slo";
import { querySloBudgetNow, querySloBudgetSeries } from "./slo-series.server";
import {
  ALERTING_SLO_RESERVED_LABEL_KEYS,
  ALERTING_SYNTHETIC_LABEL_KEYS,
  ALERTING_SYNTHETIC_LABEL_VALUES,
} from "./synthetic-labels";
import type { AlertingRuleView, AlertingSloView } from "./types";

const orgId = (session: { session: { activeOrganizationId: string } }) =>
  session.session.activeOrganizationId;

function createSloQuery(organizationId: string): ClickhouseQuery {
  return <T>(sql: string, params?: Record<string, unknown>) =>
    querySqlApi<T>(sql, organizationId, params);
}

// ---- Queries ----
export const listAlertingRules = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => alerting.listAllRules(orgId(session)));

export const listAlertingRulesPage = createAuthenticatedServerFn({
  method: "GET",
})
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
      // Pinned to live definitions so suppressed preview rules never leak into
      // the table.
      return alerting.listRulesPage(org, {
        limit: data.limit,
        ...(data.cursor ? { cursor: data.cursor } : {}),
        previewId: null,
      });
    }
    // The overlay needs all definitions plus the preview's registry scopes, so
    // pagination collapses to a single page.
    const [rules, scopes] = await Promise.all([
      alerting.listAllRules(org),
      getPreviewScopes(org, preview),
    ]);
    return {
      items: visibleRulesForPreview(rules, scopes),
      next_cursor: null,
    };
  });

export const getAlertingRule = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    alerting.getRule(orgId(session), ruleId),
  );

// Resolves by canonical project/slug name. With a preview selected, resolution
// goes through the live-vs-preview overlay so a preview-only or changed rule
// opens its preview copy.
export const getAlertingRuleByName = createAuthenticatedServerFn({
  method: "GET",
})
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
    let candidates: AlertingRuleView[];
    if (preview === null) {
      candidates = await alerting.listAllRules(org, { previewId: null });
    } else {
      const [rules, scopes] = await Promise.all([
        alerting.listAllRules(org),
        getPreviewScopes(org, preview),
      ]);
      candidates = visibleRulesForPreview(rules, scopes);
    }
    const rule = findByResourceName(candidates, data.project, data.slug);
    if (!rule) {
      throw new AlertingError(
        404,
        "not_found",
        `Rule not found: ${formatResourceName(data.project, data.slug)}`,
      );
    }
    return rule;
  });

export const getAlertingRuleEvaluationSeries = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      ruleId: z.string().min(1),
      timeRange: TimeRangeSchema,
      points: z.number().int().min(2).max(500).default(300),
    }),
  )
  .handler(({ data: { ruleId, timeRange, points }, context: { session } }) => {
    const { fromDate, toDate } = resolveTimeRange(timeRange);
    return alerting.getRuleEvaluationSeries(orgId(session), ruleId, {
      from: fromDate,
      to: toDate,
      points,
    });
  });

// The alert repository includes instances of suppressed preview rules/SLOs
// because previews evaluate fully, so each instance's source is resolved against the
// live-vs-preview overlay; an instance whose source is not visible is dropped
// rather than leaked into the triage feed.
export const listAlertingAlerts = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = orgId(session);
    const preview = data?.preview?.trim() || null;
    const [alerts, rules, slos, scopes] = await Promise.all([
      alerting.listAlerts(org),
      alerting.listAllRules(org),
      alerting.listSlos(org),
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

export const listAlertingSlos = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = orgId(session);
    const preview = data?.preview?.trim() || null;
    const [slos, scopes] = await Promise.all([
      alerting.listSlos(org),
      preview === null ? null : getPreviewScopes(org, preview),
    ]);
    return visibleSlosForPreview(slos, scopes);
  });

export const getAlertingSlo = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(async ({ data: { sloId }, context: { session } }) =>
    alerting.getSlo(orgId(session), sloId),
  );

// SLO analogue of getAlertingRuleByName. listSlos doesn't 404 on a miss, so no
// match throws the 404-equivalent here instead.
export const getAlertingSloByName = createAuthenticatedServerFn({
  method: "GET",
})
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
    let candidates: AlertingSloView[];
    if (preview === null) {
      candidates = await alerting.listSlos(org, { previewId: null });
    } else {
      const [slos, scopes] = await Promise.all([
        alerting.listSlos(org),
        getPreviewScopes(org, preview),
      ]);
      candidates = visibleSlosForPreview(slos, scopes);
    }
    const slo = findByResourceName(candidates, data.project, data.slug);
    if (!slo) {
      throw new AlertingError(
        404,
        "not_found",
        `SLO not found: ${formatResourceName(data.project, data.slug)}`,
      );
    }
    return slo;
  });

// Pending (null payload, real health) until the first evaluation tick writes
// a snapshot; null only when the SLO itself is gone.
export const getAlertingSloStatus = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    alerting.getSloStatus(orgId(session), sloId),
  );

export const listAlertingChannels = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => alerting.listChannels(orgId(session)));

export const listAlertingReceivers = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  alerting.listReceivers(orgId(session)),
);

export const listAlertingRoutes = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => alerting.listRoutes(orgId(session)));

export const listAlertingInhibitions = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) =>
  alerting.listInhibitions(orgId(session)),
);

export const listAlertingSilences = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => alerting.listSilences(orgId(session)));

// Alert history is scoped by organization in PostgreSQL before applying any
// source or time filters.
export const listAlertingEventHistory = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(500).default(200),
      timeRange: TimeRangeSchema,
      // Server-side WHERE: one alert instance's events.
      fingerprint: z.string().min(1).optional(),
      // Server-side WHERE: one source's rule handles. A tenant-wide newest-N
      // window would let other sources fill the cap and starve the scoped one.
      slugs: z.array(z.string().min(1)).min(1).optional(),
      // Preview-rule records are stamped with the same service.name as live
      // ones, so the live feed filters them out; a selected preview asks for
      // them back.
      preview: z.string().optional(),
    }),
  )
  .handler(
    async ({
      data: { limit, timeRange, fingerprint, slugs, preview },
      context: { session },
    }) => {
      const { fromDate, toDate } = resolveTimeRange(timeRange);
      const organizationId = orgId(session);
      const previewName = preview?.trim() || null;
      const previewIds =
        previewName === null
          ? null
          : (await getPreviewScopes(organizationId, previewName)).map(
              (scope) => scope.id,
            );
      return queryPostgresAlertEventLog(organizationId, {
        limit,
        from: fromDate,
        to: toDate,
        previewIds,
        ...(fingerprint !== undefined ? { fingerprint } : {}),
        ...(slugs !== undefined ? { slugs } : {}),
      });
    },
  );

// Computed at read time (no stored samples), so a fresh SLO charts history as
// far back as retention. The SLO is fetched server-side for the authoritative
// SLI/target/window rather than trusting the client; the per-org SQL API user
// pins tenancy independently of the tenant-authored SQL and applies readonly
// resource limits.
export const getAlertingSloBudgetSeries = createAuthenticatedServerFn({
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
      const slo = await alerting.getSlo(org, sloId);
      const windowSecs = alertingSloWindowSecs(slo.spec);
      if (windowSecs === null) return [];
      const { fromISO, toISO } = resolveTimeRange(timeRange);

      // Both chart and hero compute through "now" at read time.
      return querySloBudgetSeries(createSloQuery(org), {
        sliSql: slo.spec.sli.sql,
        targetPercent: slo.spec.targetPercent,
        windowSecs,
        fromISO,
        toISO,
        points,
      });
    },
  );

// Read-time budget that overrides the stored snapshot's throttled value. An
// unparsable window shorthand returns null. The SLI runs as the hardened per-org
// SQL API user because its SQL is tenant-authored.
export const getAlertingSloBudgetNow = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ sloId: z.string().min(1) }))
  .handler(async ({ data: { sloId }, context: { session } }) => {
    const org = orgId(session);
    const slo = await alerting.getSlo(org, sloId);
    const windowSecs = alertingSloWindowSecs(slo.spec);
    if (windowSecs === null) return null;
    return querySloBudgetNow(createSloQuery(org), {
      sliSql: slo.spec.sli.sql,
      targetPercent: slo.spec.targetPercent,
      windowSecs,
      nowMs: Date.now(),
    });
  });

// ---- Label suggestions ----
// Sources are merged best-effort (Promise.allSettled): suggestions must never
// fail or block typing, so a source that errors just drops out of the list.

/** Bounded lookback for observed keys/values; matchers outlive instances. */
const SUGGESTION_WINDOW = { from: "now-7d", to: "now" } as const;
const SUGGESTION_LIMIT = 100;

export type AlertingLabelKeySuggestion = { key: string; synthetic: boolean };
export type AlertingLabelValueSuggestion = { value: string; hint?: string };

const settled = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
  r.status === "fulfilled" ? r.value : fallback;

/**
 * Ordering guarantee: reserved keys first (flagged synthetic), then
 * keys alerts have actually carried (event history in frequency order,
 * declared label_columns, current instance labels).
 */
export const listAlertingLabelKeys = createAuthenticatedServerFn({
  method: "GET",
}).handler(
  async ({ context: { session } }): Promise<AlertingLabelKeySuggestion[]> => {
    const { fromDate, toDate } = resolveTimeRange(SUGGESTION_WINDOW);
    const [observed, rules, alerts] = await Promise.allSettled([
      queryPostgresObservedLabelKeys(orgId(session), {
        limit: SUGGESTION_LIMIT,
        from: fromDate,
        to: toDate,
      }),
      alerting.listAllRules(orgId(session)),
      alerting.listAlerts(orgId(session)),
    ]);
    const merged = new Set<string>(settled(observed, []));
    for (const rule of settled(rules, []))
      for (const key of rule.spec.label_columns) merged.add(key);
    for (const alert of settled(alerts, []))
      for (const key of Object.keys(alert.labels)) merged.add(key);
    // Reserved dispatch labels win collisions.
    const reserved = [
      ...ALERTING_SYNTHETIC_LABEL_KEYS,
      ...ALERTING_SLO_RESERVED_LABEL_KEYS,
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
 * Values for one label key. Synthetic keys use the dispatch vocabulary;
 * `rule` and `slo` return IDs with friendly names as hints. Other keys merge
 * instance labels with stored event history.
 */
export const listAlertingLabelValues = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ key: z.string().min(1) }))
  .handler(
    async ({
      data: { key },
      context: { session },
    }): Promise<AlertingLabelValueSuggestion[]> => {
      const staticValues =
        ALERTING_SYNTHETIC_LABEL_VALUES[
          key as keyof typeof ALERTING_SYNTHETIC_LABEL_VALUES
        ];
      if (staticValues) return staticValues.map((value) => ({ value }));
      switch (key) {
        case "rule": {
          const rules = await alerting
            .listAllRules(orgId(session))
            .catch(() => []);
          return rules.map((rule) => ({
            value: rule.id,
            hint: alertingRuleIdentity(rule).name,
          }));
        }
        case "slo": {
          const slos = await alerting.listSlos(orgId(session)).catch(() => []);
          return slos.map((slo) => ({
            value: slo.id,
            hint: alertingSloIdentity(slo).name,
          }));
        }
        case "slo_tier": {
          // Every SLO evaluates the same fixed canonical tiers, so the names
          // are constant.
          return ALERTING_CANONICAL_SLO_TIERS.map((tier) => ({
            value: tier.name,
          }));
        }
        default: {
          const { fromDate, toDate } = resolveTimeRange(SUGGESTION_WINDOW);
          const [alerts, observed] = await Promise.allSettled([
            alerting.listAlerts(orgId(session)),
            queryPostgresObservedLabelValues(orgId(session), key, {
              limit: SUGGESTION_LIMIT,
              from: fromDate,
              to: toDate,
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
export const pauseAlertingRule = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    alerting.pauseRule(orgId(session), ruleId),
  );

export const resumeAlertingRule = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    alerting.resumeRule(orgId(session), ruleId),
  );

// ---- SLO operations ----
export const pauseAlertingSlo = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    alerting.pauseSlo(orgId(session), sloId),
  );

export const resumeAlertingSlo = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ sloId: z.string() }))
  .handler(({ data: { sloId }, context: { session } }) =>
    alerting.resumeSlo(orgId(session), sloId),
  );

// SLOs are as-code resources: deliberately no delete server fn for the UI.
// Deletion happens by removing the document from the repo and re-applying.

// ---- Channels ----
// Channel names are unique within an organization.
export const createAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: z.string().min(1),
      config: AlertingChannelConfigSchema,
    }),
  )
  .handler(({ data, context: { session } }) =>
    alerting.createChannel(orgId(session), data),
  );

// Config replacement requires re-entering write-only secrets. References use IDs.
export const updateAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: z.string().min(1),
      newName: z.string().min(1).optional(),
      config: AlertingChannelConfigSchema,
    }),
  )
  .handler(({ data, context: { session } }) =>
    alerting.updateChannel(orgId(session), data.name, {
      name: data.newName,
      config: data.config,
    }),
  );

// A referenced channel answers 409 whose message names the referring
// receivers, surfaced verbatim in the UI toast.
export const deleteAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ name: z.string().min(1) }))
  .handler(({ data: { name }, context: { session } }) =>
    alerting.deleteChannel(orgId(session), name),
  );

// An email config's `to` is replaced with the caller's own address (see
// emailTestConfigFor); every other kind forwards untouched.
export const testAlertingChannel = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ config: AlertingChannelConfigSchema }))
  .handler(({ data, context: { session } }) =>
    alerting.testChannel(orgId(session), {
      config: emailTestConfigFor(data.config, session.user.email),
    }),
  );

// ---- Receivers ----
// Receiver names are unique; channel references use names at this boundary.
export const createAlertingReceiver = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: z.string().min(1),
      channels: z.array(z.string().min(1)).min(1),
    }),
  )
  .handler(({ data, context: { session } }) =>
    alerting.createReceiver(orgId(session), data),
  );

// Accept only editable fields. Route references use receiver IDs.
export const updateAlertingReceiver = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      name: z.string().min(1),
      newName: z.string().min(1).optional(),
      channels: z.array(z.string().min(1)).min(1),
    }),
  )
  .handler(({ data, context: { session } }) =>
    alerting.updateReceiver(orgId(session), data.name, {
      name: data.newName,
      channels: data.channels,
    }),
  );

export const deleteAlertingReceiver = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ name: z.string().min(1) }))
  .handler(({ data: { name }, context: { session } }) =>
    alerting.deleteReceiver(orgId(session), name),
  );

// ---- Routes ----
export const createAlertingRoute = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingRouteInputSchema)
  .handler(({ data, context: { session } }) =>
    alerting.createRoute(orgId(session), data),
  );

export const updateAlertingRoute = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string(), input: AlertingRouteInputSchema }))
  .handler(({ data: { id, input }, context: { session } }) =>
    alerting.updateRoute(orgId(session), id, input),
  );

export const deleteAlertingRoute = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    alerting.deleteRoute(orgId(session), id),
  );

// ---- Inhibitions ----
export const createAlertingInhibition = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingInhibitionInputSchema)
  .handler(({ data, context: { session } }) =>
    alerting.createInhibition(orgId(session), data),
  );

export const deleteAlertingInhibition = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    alerting.deleteInhibition(orgId(session), id),
  );

// ---- Silences ----
export const createAlertingSilence = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(AlertingSilenceInputSchema)
  .handler(({ data, context: { session } }) =>
    alerting.createSilence(orgId(session), data),
  );

export const deleteAlertingSilence = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    alerting.deleteSilence(orgId(session), id),
  );
