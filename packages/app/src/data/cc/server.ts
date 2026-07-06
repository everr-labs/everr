import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import { queryAlertEventLog } from "@/data/alerts/history.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import * as cc from "./client";
import { CcMatcherSchema, CcRuleSpecSchema } from "./schema";

const orgId = (session: { session: { activeOrganizationId: string } }) =>
  session.session.activeOrganizationId;

// ---- Queries ----
export const listCcRules = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listRules(orgId(session)));

export const getCcRule = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    cc.getRule(orgId(session), ruleId),
  );

export const listCcAlerts = createAuthenticatedServerFn({
  method: "GET",
}).handler(({ context: { session } }) => cc.listAlerts(orgId(session)));

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
