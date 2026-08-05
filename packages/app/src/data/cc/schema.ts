import { z } from "zod";

export const CcSeveritySchema = z.enum(["info", "warning", "critical"]);
export const CcMatchOpSchema = z.enum(["eq", "ne", "regex", "notregex"]);
const CcInstanceStatusSchema = z.enum(["inactive", "pending", "firing"]);

// CC serializes every API timestamp as RFC-3339, which `new Date(...)` parses.
const CcTimestampSchema = z.string();
const CcTimestampNullable = CcTimestampSchema.nullable();

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
  max_interval_secs: z.number().int().positive().optional(),
  // Preview mode: evaluated fully, never notified on. Defaulted so
  // pre-suppression CC responses still parse.
  suppressed: z.boolean().default(false),
});

export const CcRuleHealthStatusSchema = z.enum(["healthy", "degraded"]);

const CcRuleHealthSchema = z.object({
  // `.catch("healthy")`: vocabulary drift keeps parsing (readers already
  // treated non-"degraded" as healthy) instead of failing the whole
  // rule-list parse.
  status: CcRuleHealthStatusSchema.catch("healthy"),
  consecutive_failures: z.number().int(),
  degraded_since: CcTimestampNullable,
  last_error: z.string().nullable(),
  last_error_at: CcTimestampNullable,
});

export const CcRuleSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  // `name` is deliberately not defaulted: it is the key the as-code reconciler
  // matches and prunes on, so defaulting to "" would collapse the scope map and
  // turn the next apply into duplicate-creates plus a wrong prune (silent data
  // loss). CC's column is NOT NULL, so an absent name means an incompatible
  // server; failing the parse is the safe answer.
  namespace: z.string(),
  name: z.string(),
  spec: CcRuleSpecSchema,
  version: z.number().int(),
  paused: z.boolean(),
});

// SP2 2a's nested `rollup` object on each RuleView.
const CcRuleRollupSchema = z.object({
  alert_state: CcInstanceStatusSchema,
  firing_instance_count: z.number().int().default(0),
  last_fired_at: CcTimestampNullable,
  last_resolved_at: CcTimestampNullable,
  last_seen_at: CcTimestampNullable,
  last_row_count: z.number().int().nullable().optional(),
});

export const CcRuleViewSchema = CcRuleSchema.extend({
  // NOT NULL column CC always serializes, so required. Only on the view:
  // create/update/pause responses are the bare Rule.
  updated_at: CcTimestampSchema,
  health: CcRuleHealthSchema,
  // Optional for rollout safety: a CC not yet on SP2 2a omits `rollup`, and
  // requiring it would break the whole rule-list parse.
  rollup: CcRuleRollupSchema.optional(),
});

// Paginated `GET /v1/rules`: `limit`/`cursor` opt into this envelope.
// `next_cursor` is an opaque keyset token; null means the last page.
export const CcRulesPageSchema = z.object({
  items: z.array(CcRuleViewSchema),
  next_cursor: z.string().nullable(),
});

export const CcAlertSchema = z.object({
  key: z.string(),
  // CC's wire convention (SourceIdWire, domain/ids.rs): `rule` always carries
  // the source uuid (the SLO's uuid for SLO-sourced rows); `slo` is
  // additionally present for SLO sources.
  rule: z.string(),
  slo: z.string().optional(),
  tenant: z.string(),
  status: CcInstanceStatusSchema,
  labels: z.record(z.string(), z.string()),
  value: z.number().nullable(),
  active_since: CcTimestampNullable,
  last_seen: CcTimestampNullable,
  absent_count: z.number().int(),
});

// Mirrors ChannelConfig (domain/channel.rs). Secret fields come back
// redacted ("***") on read.
export const CcChannelConfigSchema = z.discriminatedUnion("type", [
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

export const CcChannelSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  name: z.string(),
  config: CcChannelConfigSchema,
});

export const CcReceiverSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  name: z.string(),
  // Channel NAMES, not configs: the engine rejects empty lists and validates
  // every name, so a parsed receiver has >= 1 element and never carries a secret.
  channels: z.array(z.string()).min(1),
  // The engine also serializes `annotations`, an API-only metadata map the app
  // neither displays nor edits; dropping it here keeps the app blind to it.
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
  repeat_interval_secs: z.number().int().nullable(),
});

// ---- Create/update input bodies ----
// Both the client types (types.ts) and the server-fn input validators
// (server.ts) derive from these, so the two cannot drift.

export const CcRouteInputSchema = z.object({
  matchers: z.array(CcMatcherSchema),
  receiver: z.string().min(1),
  continue: z.boolean(),
  priority: z.number().int(),
  group_by: z.array(z.string()).nullable(),
  group_wait_secs: z.number().int().min(0).nullable(),
  group_interval_secs: z.number().int().min(0).nullable(),
  repeat_interval_secs: z.number().int().min(60).nullable(),
});

// POST /v1/rules body (CreateRuleBody): spec flattened beside `name`,
// `namespace` defaulting to "". PUT keeps taking the bare spec (+ version):
// identity is immutable after create.
export const CcRuleInputSchema = CcRuleSpecSchema.extend({
  name: z.string().min(1),
  namespace: z.string().default(""),
});

export const CcInhibitionInputSchema = z.object({
  source_matchers: z.array(CcMatcherSchema),
  target_matchers: z.array(CcMatcherSchema),
  equal: z.array(z.string()),
});

export const CcSilenceInputSchema = z.object({
  // The engine reads a missing label as "", so a matcher with an empty label
  // would match every alert (a global silence).
  matchers: z
    .array(
      CcMatcherSchema.refine((m) => m.label.trim() !== "", {
        message: "matcher label is required",
      }),
    )
    .min(1),
  starts_at: z.string(),
  ends_at: z.string(),
  comment: z.string().optional(),
  author: z.string().optional(),
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

// ---- SLOs ----
// Mirrors domain/slo.rs serializers. Field names are the OpenSLO-aligned
// serde renames (targetPercent, timeWindow, isRolling).

// BurnRateTier.
export const CcSloTierSchema = z.object({
  name: z.string(),
  long_window: z.string(),
  short_window: z.string(),
  burn_rate: z.number(),
  severity: CcSeveritySchema,
});

export const CcSloSpecSchema = z.object({
  sli: z.object({
    sql: z.string(),
  }),
  targetPercent: z.number(),
  timeWindow: z.object({
    duration: z.string(),
    isRolling: z.boolean().default(true),
    calendar: z
      .object({ startTime: z.string(), timeZone: z.string() })
      .optional(),
  }),
  // Serde skips when None, so it arrives absent rather than null.
  min_valid_events: z.number().int().optional(),
  annotations: z.record(z.string(), z.string()).default({}),
  // Preview mode: evaluated fully, never notified on.
  suppressed: z.boolean().default(false),
});

export const CcSloSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  namespace: z.string().default(""),
  // Unique per (tenant, namespace); a first-class column, not part of the spec.
  name: z.string(),
  spec: CcSloSpecSchema,
  version: z.number().int(),
  paused: z.boolean().default(false),
});

// SloView (api/slos.rs): bare Slo plus `updated_at` (NOT NULL, always
// serialized, so required). Only on the read view: create/update/pause/resume
// responses stay the bare CcSloSchema.
export const CcSloViewSchema = CcSloSchema.extend({
  updated_at: CcTimestampSchema,
  // When the error budget last began: creation or the last budget-significant
  // edit (sli / target / window), NOT pause/resume or a rename. The chart
  // splits reconstructed (pre-epoch) history from the real budget here.
  budget_epoch: CcTimestampSchema,
});

// Mirrors stores/pg.rs SloHealth (same status vocabulary as rule health).
const CcSloHealthSchema = z.object({
  status: CcRuleHealthStatusSchema.catch("healthy"),
  degraded_since: CcTimestampNullable,
  last_error: z.string().nullable(),
});

// Mirrors engine/slo_math.rs SloTierStatus.
const CcSloTierStatusSchema = z.object({
  name: z.string(),
  long_burn_rate: z.number().nullable(),
  short_burn_rate: z.number().nullable(),
  // Additive on the Rust side (#[serde(default)]): old snapshots omit it.
  long_window_valid: z.number().nullable().default(null),
});

// SloStatusPayload plus the read-time enrichment api/slos.rs adds
// (time_to_exhaustion_secs, firing_tiers). Legacy rows are served without
// the enrichment, so both enriched fields tolerate absence.
export const CcSloStatusPayloadSchema = z.object({
  // The window shorthand ("30d") the snapshot was computed against.
  window: z.string(),
  target_percent: z.number(),
  sli: z.number().nullable(),
  budget_remaining: z.number().nullable(),
  tiers: z.array(CcSloTierStatusSchema),
  time_to_exhaustion_secs: z.number().nullable().default(null),
  firing_tiers: z
    .array(z.object({ tier: z.string(), status: CcInstanceStatusSchema }))
    .default([]),
  // WindowReq.name ("300s") -> unix seconds last computed.
  window_computed_at: z.record(z.string(), z.number()).default({}),
});

// GET /v1/slos/:id/status (SloStatusOut). A stored payload predating the
// current snapshot shape is served raw, so a non-parsing payload degrades to
// null (the pending state) instead of failing the whole status read.
export const CcSloStatusSchema = z.object({
  // Null until the first evaluation writes a snapshot (CC's pending state).
  computed_at: CcTimestampSchema.nullable(),
  payload: CcSloStatusPayloadSchema.nullable().catch(null),
  health: CcSloHealthSchema,
});

// POST /v1/slos body (CreateSloBody): spec flattened beside `name`,
// `namespace` defaulting to "".
export const CcSloInputSchema = CcSloSpecSchema.extend({
  name: z.string().min(1),
  namespace: z.string().default(""),
});
// PUT body: spec only (identity is immutable after create); the client adds
// the optional optimistic-concurrency `version`.
export const CcSloUpdateSchema = CcSloSpecSchema;

// POST /v1/slos/test: scalar SLI over the spec's own budget window.
export const CcSloTestResultSchema = z.object({
  good: z.number(),
  valid: z.number(),
  sli: z.number().nullable(),
});

export const CcDeletedSchema = z.object({ deleted: z.boolean() });

// POST /v1/channel-tests: a synthetic notification through an unsaved config.
export const CcChannelTestResultSchema = z.object({
  ok: z.boolean(),
  latency_ms: z.number(),
  // Present only when ok is false; CC omits the field on success.
  error: z.string().optional(),
});
