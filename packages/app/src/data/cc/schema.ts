import { z } from "zod";

export const CcSeveritySchema = z.enum(["info", "warning", "critical"]);
export const CcMatchOpSchema = z.enum(["eq", "ne", "regex", "notregex"]);
export const CcInstanceStatusSchema = z.enum(["inactive", "pending", "firing"]);

// CC serializes every API timestamp as an RFC-3339 string (serde's rfc3339
// format on `OffsetDateTime`), which `new Date(...)` parses directly.
export const CcTimestampSchema = z.string();
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
  max_interval_secs: z.number().int().positive().optional(),
  // Preview mode: CC evaluates the rule fully (instances, events, history) but
  // the dispatcher never notifies on it. Defaulted so pre-suppression CC
  // responses still parse.
  suppressed: z.boolean().default(false),
});

// The engine's rule-health vocabulary. Consumers (health filter, badges)
// derive from this schema rather than re-declaring the union.
export const CcRuleHealthStatusSchema = z.enum(["healthy", "degraded"]);

export const CcRuleHealthSchema = z.object({
  // `.catch("healthy")`: the previous z.string() tolerated unknown values, and
  // every reader already treated non-"degraded" as healthy, so vocabulary
  // drift keeps parsing (and keeps its old healthy rendering) instead of
  // failing the whole rule-list parse.
  status: CcRuleHealthStatusSchema.catch("healthy"),
  consecutive_failures: z.number().int(),
  degraded_since: CcTimestampNullable,
  last_error: z.string().nullable(),
  last_error_at: CcTimestampNullable,
});

export const CcRuleSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  // Defaulted rather than required: pre-migration CC responses omit these,
  // but the API always returns them post-migration. See CcSloSchema's `name`
  // (required, no default) for the SLO analogue, which predates this rollout.
  namespace: z.string().default(""),
  name: z.string().default(""),
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
  // When the rule row was last written (create, spec update, pause/resume).
  // Backed by a NOT NULL column CC always serializes, so it is required here.
  // Only on the view: create/update/pause responses are the bare Rule.
  updated_at: CcTimestampSchema,
  health: CcRuleHealthSchema,
  // Optional for rollout safety: a CC not yet on SP2 2a omits `rollup`, and
  // requiring it would break the whole rule-list parse (and the alerts
  // surface + the as-code reconciler). Consumers read it defensively.
  rollup: CcRuleRollupSchema.optional(),
});

// Paginated `GET /v1/rules`: passing `limit`/`cursor` opts into this
// `{items, next_cursor}` envelope (the bare call keeps returning the legacy
// unbounded array). `next_cursor` is an opaque keyset token; null means the
// last page.
export const CcRulesPageSchema = z.object({
  items: z.array(CcRuleViewSchema),
  next_cursor: z.string().nullable(),
});

export const CcAlertSchema = z.object({
  key: z.string(),
  // The source uuid. CC's wire convention (SourceIdWire in domain/ids.rs):
  // `rule` always carries the uuid — for SLO-sourced rows it is the SLO's
  // uuid — and `slo` is additionally present for SLO sources.
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

// The engine's per-type endpoint config (ChannelConfig in clickety-clack's
// domain/channel.rs). Secret fields come back redacted ("***") on read.
export const CcChannelConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("webhook"), url: z.string() }),
  z.object({ type: z.literal("slack"), url: z.string() }),
  z.object({ type: z.literal("email"), to: z.array(z.string()) }),
  z.object({
    type: z.literal("telegram"),
    bot_token: z.string(),
    chat_ids: z.array(z.string()),
  }),
]);

// A named, reusable channel: the secret-bearing endpoint config, unique by
// name per tenant. Receivers reference channels by name.
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
  // A receiver is a named set of channel REFERENCES (channel names); the
  // engine rejects empty lists and validates every name against the tenant's
  // channels, so a parsed receiver always has at least one element and never
  // carries a secret.
  channels: z.array(z.string()).min(1),
  // Free-form, non-secret metadata (ownership markers, team, links, ...). CC
  // always serializes it (empty map when unset), so it is effectively always
  // present; kept `.optional()` rather than `.default({})` so the inferred
  // output type does not force every hand-built CcReceiver literal (tests,
  // fixtures) to carry the field. All readers use optional chaining.
  annotations: z.record(z.string(), z.string()).optional(),
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
// The POST/PUT payloads the engine accepts, defined once here: the client
// types (data/cc/types.ts) and the server-fn input validators (data/cc/
// server.ts) both derive from these, so the two can never drift.

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

// POST /v1/rules body (CreateRuleBody): the spec flattened beside `name`,
// with `namespace` defaulting to "" (the same shape the engine serializes
// back on CcRuleSchema). PUT keeps taking the bare spec (+ version):
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
  // A silence is always scoped: the engine reads a missing label as "", so a
  // matcher with an empty label matches every alert (a global silence).
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

export const CcSubscriptionSchema = z.object({
  id: z.string(),
  tenant: z.string(),
  webhook_url: z.string(),
  created_at: CcTimestampSchema,
});

// ---- SLOs ----
// Mirrors clickety-clack's domain/slo.rs serializers. Field names are the
// OpenSLO-aligned serde renames (targetPercent, timeWindow, isRolling).

// One multi-window burn-rate tier (BurnRateTier).
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
    // Columns that fan the SLO out into per-group SLIs; empty = scalar SLO.
    label_columns: z.array(z.string()).default([]),
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

// GET /v1/slos and GET /v1/slos/:id return the SloView (api/slos.rs): the bare
// Slo plus `updated_at`, the row's last write (create, spec update, pause/
// resume). Backed by a NOT NULL column CC always serializes, so it is required
// here — the SLO analogue of CcRuleViewSchema. Only on the read view:
// create/update/pause/resume responses stay the bare CcSloSchema.
export const CcSloViewSchema = CcSloSchema.extend({
  updated_at: CcTimestampSchema,
  // When the error budget last began — creation, or the last budget-significant
  // edit (sli / target / window), but NOT pause/resume or a rename. The
  // budget-over-time chart splits reconstructed (pre-epoch) history from the
  // real budget here.
  budget_epoch: CcTimestampSchema,
});

// The evaluator's health sibling on GET /v1/slos/:id/status (stores/pg.rs
// SloHealth — a leaner cousin of CcRuleHealthSchema, same status vocabulary).
export const CcSloHealthSchema = z.object({
  status: CcRuleHealthStatusSchema.catch("healthy"),
  degraded_since: CcTimestampNullable,
  last_error: z.string().nullable(),
});

// Per-tier burn rates inside a status group (engine/slo_math.rs SloTierStatus).
export const CcSloTierStatusSchema = z.object({
  name: z.string(),
  long_burn_rate: z.number().nullable(),
  short_burn_rate: z.number().nullable(),
  // Additive on the Rust side (#[serde(default)]): old snapshots omit it.
  long_window_valid: z.number().nullable().default(null),
});

// One group of the status snapshot (SloGroupStatus), plus the read-time
// enrichment api/slos.rs adds per group (time_to_exhaustion_secs and
// firing_tiers). Legacy rows are served raw without the enrichment, so both
// enriched fields tolerate absence.
export const CcSloGroupStatusSchema = z.object({
  labels: z.record(z.string(), z.string()),
  sli: z.number().nullable(),
  budget_remaining: z.number().nullable(),
  tiers: z.array(CcSloTierStatusSchema),
  time_to_exhaustion_secs: z.number().nullable().default(null),
  firing_tiers: z
    .array(z.object({ tier: z.string(), status: CcInstanceStatusSchema }))
    .default([]),
});

export const CcSloStatusPayloadSchema = z.object({
  // The budget window shorthand ("30d") and objective the snapshot was
  // computed against.
  window: z.string(),
  target_percent: z.number(),
  groups: z.array(CcSloGroupStatusSchema).default([]),
  // WindowReq.name ("300s") -> unix seconds last computed.
  window_computed_at: z.record(z.string(), z.number()).default({}),
});

// GET /v1/slos/:id/status (SloStatusOut). The stored payload predating the
// current snapshot shape is served raw and unenriched, so a payload that does
// not parse degrades to null (the detail page's pending state) instead of
// failing the whole status read.
export const CcSloStatusSchema = z.object({
  computed_at: CcTimestampSchema,
  payload: CcSloStatusPayloadSchema.nullable().catch(null),
  health: CcSloHealthSchema,
});

// POST /v1/slos body (CreateSloBody): the spec flattened beside `name`, with
// `namespace` defaulting to "".
export const CcSloInputSchema = CcSloSpecSchema.extend({
  name: z.string().min(1),
  namespace: z.string().default(""),
});
// PUT /v1/slos/:id body (UpdateSloBody): spec only, plus optional
// optimistic-concurrency `version` (added by the client, not the schema).
// Identity (namespace/name) is immutable after create.
export const CcSloUpdateSchema = CcSloSpecSchema;

// POST /v1/slos/:id/test: per-group SLI over the spec's own budget window.
export const CcSloTestResultSchema = z.object({
  matched: z.number().int(),
  groups: z.array(
    z.object({
      labels: z.record(z.string(), z.string()),
      good: z.number(),
      valid: z.number(),
      sli: z.number().nullable(),
    }),
  ),
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
