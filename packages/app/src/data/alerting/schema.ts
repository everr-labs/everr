import { z } from "zod";
import { PreviewStatusSchema } from "@/data/previews/overlay";
import { ALERTING_DEFAULT_TIERS } from "./delivery/defaults";
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
// A comment is frozen onto every terminal the silence withholds, and an
// append-only column cannot be trimmed later.
export const ALERTING_SILENCE_COMMENT_MAX = 1024;

export const AlertingMatcherSchema = z.object({
  label: z.string().max(ALERTING_MATCHER_LABEL_MAX),
  op: AlertingMatchOpSchema,
  value: z.string().max(ALERTING_MATCHER_VALUE_MAX),
});

const alertingMatchersSchema = <T extends z.ZodType>(matcher: T) =>
  z.array(matcher).max(ALERTING_MATCHERS_MAX);

// Present only when the rule overrides the default destination, exactly as
// authored in the YAML's `notifications` block.
const AlertingRuleNotificationsSchema = z.object({
  channels: AlertingChannelNamesSchema,
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
  notifications: AlertingRuleNotificationsSchema.optional(),
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

// A channel name is what a rule's `notifications.channels` names and what
// delivery resolves at flush time, so an empty one would be a channel nothing
// can ever address.
const ALERTING_CHANNEL_NAME_MAX = 128;

export const AlertingChannelNameSchema = z
  .string()
  .trim()
  .min(1, { error: "channel name is required" })
  .max(ALERTING_CHANNEL_NAME_MAX);

export const AlertingChannelInputSchema = z.object({
  name: AlertingChannelNameSchema,
  config: AlertingChannelConfigSchema,
});

// Both halves are optional: an edit names only what it changes. Omitting the
// config is what lets a rename leave the credential alone without the caller
// having to read it back first, which it could not do anyway.
export const AlertingChannelUpdateSchema = AlertingChannelInputSchema.partial();

export const AlertingChannelSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  name: z.string(),
  config: AlertingChannelConfigSchema,
});

// The org default destination, keyed by tier. "all" is the unsplit mode and
// never coexists with severity tiers; the repository enforces that, since a
// record schema cannot.
export const AlertingDefaultDestinationInputSchema = z.object({
  tiers: z
    .partialRecord(
      z.enum(ALERTING_DEFAULT_TIERS),
      z.array(z.string().min(1)).max(16),
    )
    .refine(
      (tiers) =>
        Object.values(tiers).every(
          (channels) => new Set(channels).size === channels.length,
        ),
      { message: "channels must be unique within a tier" },
    ),
});

export const AlertingDefaultDestinationSchema = z.object({
  tiers: z.partialRecord(z.enum(ALERTING_DEFAULT_TIERS), z.array(z.string())),
});

export const AlertingRuleInputSchema = AlertingRuleSpecSchema.extend({
  name: alertingResourceNameSchema,
  repoid: z.string().min(1),
  previewId: z.string().nullable(),
});

export const AlertingRuleUpdateSchema = AlertingRuleSpecSchema;

// The column is a uuid, so anything else reaches Postgres as a syntax error
// rather than a miss. Every caller meets this on the way in instead.
export const AlertingSilenceIdSchema = z.string().uuid();

export const AlertingSilenceInputSchema = z.object({
  // Empty label names would turn missing labels into a global match.
  matchers: alertingMatchersSchema(
    AlertingMatcherSchema.refine((m) => m.label.trim() !== "", {
      message: "matcher label is required",
    }),
  ).min(1),
  // Validated, not bare strings: `new Date("2026-08-18 09:00:00")` parses a
  // zone-less value in the server's own timezone, and the window check still
  // passes, so the silence mutes hours nobody chose.
  starts_at: AlertingTimestampSchema,
  ends_at: AlertingTimestampSchema,
  comment: z.string().max(ALERTING_SILENCE_COMMENT_MAX).optional(),
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
