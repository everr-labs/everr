import { z } from "zod";

export const CcSeveritySchema = z.enum(["info", "warning", "critical"]);
export const CcMatchOpSchema = z.enum(["eq", "ne", "regex", "notregex"]);
export const CcInstanceStatusSchema = z.enum(["inactive", "pending", "firing"]);
export const CcEventStatusSchema = z.enum(["firing", "resolved"]);

// CC serializes `OffsetDateTime` with the `time` crate's DEFAULT format — a
// numeric array `[year, ordinalDay, hour, minute, second, nanosecond,
// offsetH, offsetM, offsetS]` (UTC ⇒ trailing zeros) — NOT the RFC-3339 string
// its HTTP docs advertise. Accept either and normalize to an ISO-8601 string so
// the UI's `new Date(...)` formatting works regardless of which CC emits.
function timeArrayToIso(a: number[]): string {
  const [year, ordinalDay, hour = 0, minute = 0, second = 0, nanos = 0] = a;
  return new Date(
    Date.UTC(
      year,
      0,
      ordinalDay,
      hour,
      minute,
      second,
      Math.floor(nanos / 1e6),
    ),
  ).toISOString();
}
export const CcTimestampSchema = z
  .union([z.string(), z.array(z.number())])
  .transform((v) => (typeof v === "string" ? v : timeArrayToIso(v)));
export const CcTimestampNullable = CcTimestampSchema.nullable();

export const CcMatcherSchema = z.object({
  label: z.string(),
  op: CcMatchOpSchema,
  value: z.string(),
});

export const CcRuleSpecSchema = z.object({
  sql: z.string(),
  interval_secs: z.number().int(),
  for_secs: z.number().int(),
  label_columns: z.array(z.string()),
  value_column: z.string().nullable().optional(),
  severity: CcSeveritySchema,
  annotations: z.record(z.string(), z.string()).default({}),
  resolve_after: z.number().int().default(1),
});

export const CcRuleHealthSchema = z.object({
  status: z.string(), // observed: "healthy" | "degraded"
  consecutive_failures: z.number().int(),
  degraded_since: CcTimestampNullable,
  last_error: z.string().nullable(),
  last_error_at: CcTimestampNullable,
});

export const CcRuleSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  spec: CcRuleSpecSchema,
  version: z.number().int(),
  paused: z.boolean(),
});

// SP2 2a rolls up alert state onto each RuleView under a nested `rollup` object.
export const CcRuleRollupSchema = z.object({
  alert_state: CcInstanceStatusSchema,
  firing_instance_count: z.number().int().default(0),
  last_fired_at: CcTimestampNullable,
  last_resolved_at: CcTimestampNullable,
  last_seen_at: CcTimestampNullable,
  last_row_count: z.number().int().nullable().optional(),
});

export const CcRuleViewSchema = CcRuleSchema.extend({
  health: CcRuleHealthSchema,
  // Optional for rollout safety: a CC not yet on SP2 2a omits `rollup`, and
  // requiring it would break the whole rule-list parse (and /cc-alerting + the
  // as-code reconciler). Consumers read it defensively.
  rollup: CcRuleRollupSchema.optional(),
});

export const CcAlertSchema = z.object({
  key: z.string(),
  rule: z.string(),
  tenant: z.string(),
  status: CcInstanceStatusSchema,
  labels: z.record(z.string(), z.string()),
  value: z.number().nullable(),
  active_since: CcTimestampNullable,
  last_seen: CcTimestampNullable,
  absent_count: z.number().int(),
});

export const CcChannelSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook"), url: z.string() }),
  z.object({ type: z.literal("slack"), url: z.string() }),
  z.object({ type: z.literal("pagerduty"), routing_key: z.string() }),
  z.object({ type: z.literal("email"), to: z.array(z.string()) }),
  z.object({
    type: z.literal("telegram"),
    bot_token: z.string(),
    chat_ids: z.array(z.string()),
  }),
]);

export const CcReceiverSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  name: z.string(),
  channel: CcChannelSchema,
});

export const CcRouteSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  matchers: z.array(CcMatcherSchema),
  receiver: z.string(),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().nullable(),
  group_interval_secs: z.number().int().nullable(),
});

export const CcSilenceSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  matchers: z.array(CcMatcherSchema),
  starts_at: CcTimestampSchema,
  ends_at: CcTimestampSchema,
  comment: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  created_at: CcTimestampSchema,
});

export const CcInhibitionSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  source_matchers: z.array(CcMatcherSchema),
  target_matchers: z.array(CcMatcherSchema),
  equal: z.array(z.string()).nullable().optional(),
  created_at: CcTimestampSchema,
});

export const CcSubscriptionSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  webhook_url: z.string(),
});

export const CcEventSchema = z.object({
  tenant: z.string(),
  rule: z.string(),
  instance_key: z.string(),
  status: CcEventStatusSchema,
  kind: z.string().optional(),
  labels: z.record(z.string(), z.string()),
  value: z.number().nullable(),
  severity: CcSeveritySchema,
  annotations: z.record(z.string(), z.string()),
  eval_ts: CcTimestampSchema,
});

export const CcTestResultSchema = z.object({
  matched: z.number().int(),
  rows: z.array(
    z.object({
      labels: z.record(z.string(), z.string()),
      value: z.number().nullable(),
    }),
  ),
});

export const CcDeletedSchema = z.object({ deleted: z.boolean() });
