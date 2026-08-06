import { z } from "zod";

export const AlertingSeveritySchema = z.enum(["info", "warning", "critical"]);
export const AlertingMatchOpSchema = z.enum(["eq", "ne", "regex", "notregex"]);
const AlertingRuleConditionOperatorSchema = z.enum([
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
]);
export const AlertingRuleConditionSchema = z
  .object({
    operator: AlertingRuleConditionOperatorSchema,
    threshold: z.number().finite(),
  })
  .strict();
const AlertingInstanceStatusSchema = z.enum(["inactive", "pending", "firing"]);

// Server functions serialize timestamps as RFC 3339 strings.
const AlertingTimestampSchema = z.string();
const AlertingTimestampNullable = AlertingTimestampSchema.nullable();
const ResourceNameSchema = z.string().regex(/^[^/]+\/.+$/);
const AlertingChannelNamesSchema = z
  .array(z.string().min(1))
  .refine((channels) => new Set(channels).size === channels.length, {
    message: "notification channels must be unique",
  });

export const AlertingMatcherSchema = z.object({
  label: z.string(),
  op: AlertingMatchOpSchema,
  value: z.string(),
});

export const AlertingRuleSpecSchema = z.object({
  sql: z.string(),
  interval_secs: z.number().int().positive(),
  for_secs: z.number().int().nonnegative(),
  label_columns: z.array(z.string()),
  condition: AlertingRuleConditionSchema,
  severity: AlertingSeveritySchema,
  annotations: z.record(z.string(), z.string()).default({}),
  resolve_after: z.number().int().positive().default(1),
  max_interval_secs: z.number().int().positive().optional(),
  // Preview mode: evaluated fully, never notified on.
  suppressed: z.boolean().default(false),
});

export const AlertingRuleHealthStatusSchema = z.enum(["healthy", "degraded"]);

const AlertingRuleHealthSchema = z.object({
  status: AlertingRuleHealthStatusSchema,
  consecutive_failures: z.number().int(),
  degraded_since: AlertingTimestampNullable,
  last_error: z.string().nullable(),
  last_error_at: AlertingTimestampNullable,
});

export const AlertingRuleSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  repoid: z.string().min(1),
  previewId: z.string().nullable(),
  name: ResourceNameSchema,
  notification_channels: AlertingChannelNamesSchema,
  spec: AlertingRuleSpecSchema,
  version: z.number().int(),
  paused: z.boolean(),
});

const AlertingRuleRollupSchema = z.object({
  alert_state: AlertingInstanceStatusSchema,
  firing_instance_count: z.number().int(),
  last_fired_at: AlertingTimestampNullable,
  last_resolved_at: AlertingTimestampNullable,
  last_seen_at: AlertingTimestampNullable,
  last_row_count: z.number().int().nullable(),
});

export const AlertingRuleViewSchema = AlertingRuleSchema.extend({
  updated_at: AlertingTimestampSchema,
  health: AlertingRuleHealthSchema,
  rollup: AlertingRuleRollupSchema,
});

// Paginated `GET /v1/rules`: `limit`/`cursor` opt into this envelope.
// `next_cursor` is an opaque keyset token; null means the last page.
export const AlertingRulesPageSchema = z.object({
  items: z.array(AlertingRuleViewSchema),
  next_cursor: z.string().nullable(),
});

export const AlertingAlertSchema = z.object({
  key: z.string(),
  // `rule` carries the source id; `slo` is additionally present for SLOs.
  rule: z.string(),
  slo: z.string().optional(),
  tenant: z.string(),
  status: AlertingInstanceStatusSchema,
  labels: z.record(z.string(), z.string()),
  value: z.number().nullable(),
  active_since: AlertingTimestampNullable,
  last_seen: AlertingTimestampNullable,
  absent_count: z.number().int(),
});

// Secret fields come back redacted ("***") on read.
export const AlertingChannelConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook"), url: z.string() }),
  z.object({ type: z.literal("slack"), url: z.string() }),
  z.object({ type: z.literal("discord"), url: z.string() }),
  z.object({ type: z.literal("email"), to: z.array(z.string()) }),
  z.object({
    type: z.literal("telegram"),
    bot_token: z.string(),
    chat_ids: z.array(z.string()),
  }),
]);

export const AlertingChannelSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  name: z.string(),
  config: AlertingChannelConfigSchema,
});

export const AlertingReceiverSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  name: z.string(),
  // Channel NAMES, not configs: the engine rejects empty lists and validates
  // every name, so a parsed receiver has >= 1 element and never carries a secret.
  channels: z.array(z.string()).min(1),
  // The engine also serializes `annotations`, an API-only metadata map the app
  // neither displays nor edits; dropping it here keeps the app blind to it.
});

export const AlertingRouteSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  matchers: z.array(AlertingMatcherSchema),
  receiver: z.string(),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().nullable(),
  group_interval_secs: z.number().int().nullable(),
  repeat_interval_secs: z.number().int().nullable(),
});

// ---- Create/update input bodies ----
// Both the client types (types.ts) and the server-fn input validators
// (server.ts) derive from these, so the two cannot drift.

export const AlertingRouteInputSchema = z.object({
  matchers: z.array(AlertingMatcherSchema),
  receiver: z.string().min(1),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().min(0).nullable(),
  group_interval_secs: z.number().int().min(0).nullable(),
  repeat_interval_secs: z.number().int().min(60).nullable(),
});

// Rule creation input: the spec is flattened beside its immutable identity.
export const AlertingRuleInputSchema = AlertingRuleSpecSchema.extend({
  name: ResourceNameSchema,
  repoid: z.string().min(1),
  previewId: z.string().nullable(),
  notification_channels: AlertingChannelNamesSchema.default([]),
});

export const AlertingRuleUpdateSchema = AlertingRuleSpecSchema.extend({
  notification_channels: AlertingChannelNamesSchema.default([]),
});

export const AlertingInhibitionInputSchema = z.object({
  source_matchers: z.array(AlertingMatcherSchema),
  target_matchers: z.array(AlertingMatcherSchema),
  equal: z.array(z.string()),
});

export const AlertingSilenceInputSchema = z.object({
  // The engine reads a missing label as "", so a matcher with an empty label
  // would match every alert (a global silence).
  matchers: z
    .array(
      AlertingMatcherSchema.refine((m) => m.label.trim() !== "", {
        message: "matcher label is required",
      }),
    )
    .min(1),
  starts_at: z.string(),
  ends_at: z.string(),
  comment: z.string().optional(),
  author: z.string().optional(),
});

export const AlertingSilenceSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  matchers: z.array(AlertingMatcherSchema),
  starts_at: AlertingTimestampSchema,
  ends_at: AlertingTimestampSchema,
  comment: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  created_at: AlertingTimestampSchema,
});

export const AlertingInhibitionSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  source_matchers: z.array(AlertingMatcherSchema),
  target_matchers: z.array(AlertingMatcherSchema),
  equal: z.array(z.string()).nullable().optional(),
  created_at: AlertingTimestampSchema,
});

// ---- SLOs ----
export const AlertingSloTierSchema = z.object({
  name: ResourceNameSchema,
  long_window: z.string(),
  short_window: z.string(),
  burn_rate: z.number(),
  severity: AlertingSeveritySchema,
});

export const AlertingSloSpecSchema = z.object({
  sli: z
    .object({
      sql: z.string(),
    })
    .strict(),
  targetPercent: z.number().gt(0).lt(100),
  timeWindow: z.object({
    duration: z.string(),
    isRolling: z.boolean().default(true),
    calendar: z
      .object({ startTime: z.string(), timeZone: z.string() })
      .optional(),
  }),
  min_valid_events: z.number().int().nonnegative().optional(),
  annotations: z.record(z.string(), z.string()).default({}),
  // Preview mode: evaluated fully, never notified on.
  suppressed: z.boolean().default(false),
});

export const AlertingSloSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  repoid: z.string().min(1),
  previewId: z.string().nullable(),
  // Live names are unique per Organization; preview names are unique within
  // their owning Preview.
  name: z.string(),
  spec: AlertingSloSpecSchema,
  version: z.number().int(),
  paused: z.boolean(),
});

export const AlertingSloViewSchema = AlertingSloSchema.extend({
  updated_at: AlertingTimestampSchema,
  // When the error budget last began: creation or the last budget-significant
  // edit (sli / target / window), NOT pause/resume or a rename. The chart
  // splits reconstructed (pre-epoch) history from the real budget here.
  budget_epoch: AlertingTimestampSchema,
});

const AlertingSloHealthSchema = z.object({
  status: AlertingRuleHealthStatusSchema,
  degraded_since: AlertingTimestampNullable,
  last_error: z.string().nullable(),
});

const AlertingSloTierStatusSchema = z.object({
  name: z.string(),
  long_burn_rate: z.number().nullable(),
  short_burn_rate: z.number().nullable(),
  long_window_valid: z.number().nullable(),
});

export const AlertingSloStatusPayloadSchema = z.object({
  // The window shorthand ("30d") the snapshot was computed against.
  window: z.string(),
  target_percent: z.number(),
  sli: z.number().nullable(),
  budget_remaining: z.number().nullable(),
  tiers: z.array(AlertingSloTierStatusSchema),
  time_to_exhaustion_secs: z.number().nullable(),
  firing_tiers: z.array(
    z.object({ tier: z.string(), status: AlertingInstanceStatusSchema }),
  ),
  // WindowReq.name ("300s") -> unix seconds last computed.
  window_computed_at: z.record(z.string(), z.number()),
});

export const AlertingSloStatusSchema = z.object({
  // Null until the first evaluation writes a snapshot.
  computed_at: AlertingTimestampSchema.nullable(),
  payload: AlertingSloStatusPayloadSchema.nullable(),
  health: AlertingSloHealthSchema,
});

// Create input: spec flattened beside the immutable identity fields.
export const AlertingSloInputSchema = AlertingSloSpecSchema.extend({
  name: ResourceNameSchema,
  repoid: z.string().min(1),
  previewId: z.string().nullable(),
});
// PUT body: spec only (identity is immutable after create); the client adds
// the optional optimistic-concurrency `version`.
export const AlertingSloUpdateSchema = AlertingSloSpecSchema;
