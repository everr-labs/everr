import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { CC_SYNTHETIC_LABEL_KEYS } from "@/components/cc/route-resolution";
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
  CcMatcherSchema,
  CcRuleSpecSchema,
  CcSeveritySchema,
} from "./schema";

const orgId = (session: { session: { activeOrganizationId: string } }) =>
  session.session.activeOrganizationId;

// ---- Queries ----
export const listCcRules = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listRules(orgId(session)));

// Paginated rules listing (CC's {items, next_cursor} envelope) with an
// optional server-side health filter. listCcRules above stays the bare-array
// path for callers that want everything in one shot.
export const listCcRulesPage = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(500).default(100),
      cursor: z.string().optional(),
      health: z.enum(["degraded", "healthy"]).optional(),
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
// SQL organization filter. Backs the monitor stream's historical page.
export const listCcEventHistory = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(500).default(200),
      timeRange: TimeRangeSchema,
    }),
  )
  .handler(({ data: { limit, timeRange }, context: { clickhouse } }) => {
    const { fromISO, toISO } = resolveTimeRange(timeRange);
    return queryAlertEventLog(clickhouse.query, { limit, fromISO, toISO });
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
 * keys first (flagged, so the UI can teach that they exist), then keys alerts
 * have actually carried — stored event history (frequency order), the rules'
 * declared label_columns, and current instances' labels.
 */
export const listCcLabelKeys = createAuthenticatedServerFn({
  method: "GET",
}).handler(
  async ({
    context: { session, clickhouse },
  }): Promise<CcLabelKeySuggestion[]> => {
    const { fromISO, toISO } = resolveTimeRange(SUGGESTION_WINDOW);
    const [observed, rules, alerts] = await Promise.allSettled([
      queryObservedLabelKeys(clickhouse.query, {
        limit: SUGGESTION_LIMIT,
        fromISO,
        toISO,
      }),
      cc.listRules(orgId(session)),
      cc.listAlerts(orgId(session)),
    ]);
    const merged = new Set<string>(settled(observed, []));
    for (const rule of settled(rules, []))
      for (const key of rule.spec.label_columns) merged.add(key);
    for (const alert of settled(alerts, []))
      for (const key of Object.keys(alert.labels)) merged.add(key);
    // Synthetics win on collision at dispatch time, so they win here too.
    for (const key of CC_SYNTHETIC_LABEL_KEYS) merged.delete(key);
    return [
      ...CC_SYNTHETIC_LABEL_KEYS.map((key) => ({ key, synthetic: true })),
      ...[...merged]
        .slice(0, SUGGESTION_LIMIT)
        .map((key) => ({ key, synthetic: false })),
    ];
  },
);

/**
 * The values one label key has carried. Synthetic keys answer with the
 * engine's own vocabulary — severity/status/kind enums, and for `rule` the
 * rule IDs the dispatcher actually matches on (dispatcher/routing.rs inserts
 * `rule` as the RuleId), with the friendly name as a secondary hint. Other
 * keys merge current instances' labels with stored event history.
 */
export const listCcLabelValues = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ key: z.string().min(1) }))
  .handler(
    async ({
      data: { key },
      context: { session, clickhouse },
    }): Promise<CcLabelValueSuggestion[]> => {
      switch (key) {
        case "severity":
          return CcSeveritySchema.options.map((value) => ({ value }));
        case "status":
          return [{ value: "firing" }, { value: "resolved" }];
        case "kind":
          return [{ value: "alert" }, { value: "rule_health" }];
        case "rule": {
          const rules = await cc.listRules(orgId(session)).catch(() => []);
          return rules.map((rule) => ({
            value: rule.id,
            hint: ccRuleIdentity(rule).name,
          }));
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
const RouteInputSchema = z.object({
  matchers: z.array(CcMatcherSchema),
  receiver: z.string().min(1),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().min(0).nullable(),
  group_interval_secs: z.number().int().min(0).nullable(),
  repeat_interval_secs: z.number().int().min(60).nullable(),
});

export const createCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(RouteInputSchema)
  .handler(({ data, context: { session } }) =>
    cc.createRoute(orgId(session), data),
  );

export const updateCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), input: RouteInputSchema }))
  .handler(({ data: { id, input }, context: { session } }) =>
    cc.updateRoute(orgId(session), id, input),
  );

export const deleteCcRoute = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(({ data: { id }, context: { session } }) =>
    cc.deleteRoute(orgId(session), id),
  );

// ---- Inhibitions ----
const InhibitionInputSchema = z.object({
  source_matchers: z.array(CcMatcherSchema),
  target_matchers: z.array(CcMatcherSchema),
  equal: z.array(z.string()),
});

export const createCcInhibition = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(InhibitionInputSchema)
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
const SilenceInputSchema = z.object({
  matchers: z.array(CcMatcherSchema).min(1),
  starts_at: z.string(),
  ends_at: z.string(),
  comment: z.string().optional(),
  author: z.string().optional(),
});

export const createCcSilence = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(SilenceInputSchema)
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
