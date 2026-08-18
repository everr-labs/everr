import { z } from "zod";
import { PreviewStatusSchema } from "@/data/previews/overlay";
import {
  alertingChannelNamesSchema,
  alertingResourceNameSchema,
} from "./resource/schema";
import {
  ALERTING_HEALTH_STATUSES,
  ALERTING_INSTANCE_STATUSES,
  ALERTING_SEVERITIES,
} from "./vocabulary";

export const AlertingSeveritySchema = z.enum(ALERTING_SEVERITIES);

// Matching is exact only: user regex patterns would reach the native RegExp
// engine, where catastrophic backtracking and an unbounded pattern cache are
// a denial-of-service path.
export const AlertingMatchOpSchema = z.enum(["eq", "ne"], {
  error: () => `matcher op must be "eq" or "ne"`,
});
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
const AlertingInstanceStatusSchema = z.enum(ALERTING_INSTANCE_STATUSES);

const AlertingTimestampSchema = z.string().datetime();
const AlertingTimestampNullable = AlertingTimestampSchema.nullable();
const AlertingChannelNamesSchema = alertingChannelNamesSchema();

// Generous bounds that keep a matcher set bounded in memory and in the
// dispatcher's per-alert work. They are not a UX policy.
export const ALERTING_MATCHERS_MAX = 64;
export const ALERTING_MATCHER_LABEL_MAX = 256;
export const ALERTING_MATCHER_VALUE_MAX = 1024;

export const AlertingMatcherSchema = z.object({
  label: z.string().max(ALERTING_MATCHER_LABEL_MAX),
  op: AlertingMatchOpSchema,
  value: z.string().max(ALERTING_MATCHER_VALUE_MAX),
});

const alertingMatchersSchema = <T extends z.ZodType>(matcher: T) =>
  z.array(matcher).max(ALERTING_MATCHERS_MAX);

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
});

export const AlertingRuleHealthStatusSchema = z.enum(ALERTING_HEALTH_STATUSES);

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
  name: alertingResourceNameSchema,
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
  next_evaluation_at: AlertingTimestampNullable,
  last_row_count: z.number().int().nullable(),
});

export const AlertingRuleViewSchema = AlertingRuleSchema.extend({
  updated_at: AlertingTimestampSchema,
  health: AlertingRuleHealthSchema,
  rollup: AlertingRuleRollupSchema,
  // Only a preview-scoped read carries this: on live there is nothing to
  // compare the rule against.
  previewStatus: PreviewStatusSchema.optional(),
});

export const AlertingAlertSchema = z.object({
  key: z.string(),
  fingerprint: z.string(),
  rule: z.string(),
  tenant: z.string(),
  status: AlertingInstanceStatusSchema,
  labels: z.record(z.string(), z.string()),
  value: z.number().nullable(),
  pending_since: AlertingTimestampNullable.optional(),
  active_since: AlertingTimestampNullable,
  last_seen: AlertingTimestampNullable,
  absent_count: z.number().int(),
});

// Secret fields come back redacted ("***") on read.
export const AlertingChannelConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook"), url: z.string() }),
  z.object({ type: z.literal("slack"), url: z.string() }),
  z.object({ type: z.literal("discord"), url: z.string() }),
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
  // Receivers reference channel names and never carry channel secrets.
  channels: z.array(z.string()).min(1),
});

export const AlertingRouteSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  matchers: alertingMatchersSchema(AlertingMatcherSchema),
  receiver: z.string(),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().nullable(),
  group_interval_secs: z.number().int().nullable(),
  repeat_interval_secs: z.number().int().nullable(),
});

export const AlertingRouteInputSchema = z.object({
  matchers: alertingMatchersSchema(AlertingMatcherSchema),
  receiver: z.string().min(1),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().min(0).nullable(),
  group_interval_secs: z.number().int().min(0).nullable(),
  repeat_interval_secs: z.number().int().min(60).nullable(),
});

export const AlertingRuleInputSchema = AlertingRuleSpecSchema.extend({
  name: alertingResourceNameSchema,
  repoid: z.string().min(1),
  previewId: z.string().nullable(),
  notification_channels: AlertingChannelNamesSchema.default([]),
});

export const AlertingRuleUpdateSchema = AlertingRuleSpecSchema.extend({
  notification_channels: AlertingChannelNamesSchema.default([]),
});

export const AlertingInhibitionInputSchema = z.object({
  source_matchers: alertingMatchersSchema(AlertingMatcherSchema),
  target_matchers: alertingMatchersSchema(AlertingMatcherSchema),
  equal: z.array(z.string()),
});

export const AlertingSilenceInputSchema = z.object({
  // Empty label names would turn missing labels into a global match.
  matchers: alertingMatchersSchema(
    AlertingMatcherSchema.refine((m) => m.label.trim() !== "", {
      message: "matcher label is required",
    }),
  ).min(1),
  starts_at: z.string(),
  ends_at: z.string(),
  comment: z.string().optional(),
  // No `author`: it is stamped from the authenticated principal on the server.
});

export const AlertingSilenceSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  matchers: alertingMatchersSchema(AlertingMatcherSchema),
  starts_at: AlertingTimestampSchema,
  ends_at: AlertingTimestampSchema,
  comment: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  created_at: AlertingTimestampSchema,
  canceled_at: AlertingTimestampNullable.optional(),
});

export const AlertingInhibitionSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  source_matchers: alertingMatchersSchema(AlertingMatcherSchema),
  target_matchers: alertingMatchersSchema(AlertingMatcherSchema),
  equal: z.array(z.string()).nullable().optional(),
  created_at: AlertingTimestampSchema,
});
