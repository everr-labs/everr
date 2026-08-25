import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AlertingMatcher, AlertingRuleSpec } from "@/data/alerting/types";
import type { AlertingLifecycleReason } from "@/data/alerting/vocabulary";
import {
  ALERTING_EVENT_TYPES,
  ALERTING_INSTANCE_STATUSES,
  ALERTING_LIFECYCLE_REASONS,
  ALERTING_SEVERITIES,
} from "@/data/alerting/vocabulary";
import { previews } from "./app";

// Derived from the vocabulary export, not hand-listed, so a reason added
// there without a CHECK update fails loudly instead of journaling silently.
const ALERT_EVENTS_REASON_VOCABULARY_SQL = ["", ...ALERTING_LIFECYCLE_REASONS]
  .map((reason) => `'${reason}'`)
  .join(", ");

export const alertStateEnum = pgEnum("alert_state", [
  "unknown",
  "resolved",
  "pending",
  "firing",
]);

export const alertInstanceStateEnum = pgEnum(
  "alert_instance_state",
  ALERTING_INSTANCE_STATUSES,
);

export const alertDeliveryStateEnum = pgEnum("alert_delivery_state", [
  "pending",
  "sent",
  "failed",
]);

export const alertEventTypeEnum = pgEnum(
  "alert_event_type",
  ALERTING_EVENT_TYPES,
);

// State-only rows (pending, closed, failed evaluations) are
// born processed and exist only to be projected; they must never be
// deliverable, whatever their event type says.
export const alertEventKindEnum = pgEnum("alert_event_kind", [
  "notifying",
  "state",
]);

export const alertSeverityEnum = pgEnum("alert_severity", ALERTING_SEVERITIES);

export const alertDefinitions = pgTable(
  "alert_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    repoid: text("repoid").notNull(),
    previewId: uuid("preview_id"),
    slug: text("slug").notNull(),
    project: text("project").notNull().default("default"),
    spec: jsonb("spec").notNull().$type<AlertingRuleSpec>(),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    nextEvaluationAt: timestamp("next_evaluation_at", { withTimezone: true }),
    lastEnqueuedAt: timestamp("last_enqueued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    active: boolean("active").notNull().default(true),
    lastError: text("last_error"),
    currentState: alertStateEnum("current_state").notNull().default("unknown"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    // Non-null exactly while the rule is degraded, which is what the rule
    // view reports as its health status. A separate status column could only
    // ever restate this one.
    degradedSince: timestamp("degraded_since", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastRowCount: integer("last_row_count").notNull().default(0),
    firingInstanceCount: integer("firing_instance_count").notNull().default(0),
  },
  (table) => [
    foreignKey({
      columns: [table.previewId, table.organizationId, table.repoid],
      foreignColumns: [previews.id, previews.organizationId, previews.repoid],
      name: "alert_definitions_preview_tenant_fk",
    }).onDelete("cascade"),
    check(
      "alert_definitions_repoid_nonempty",
      sql`length(${table.repoid}) > 0`,
    ),
    check(
      "alert_definitions_project_nonempty",
      sql`length(${table.project}) > 0`,
    ),
    check("alert_definitions_slug_nonempty", sql`length(${table.slug}) > 0`),
    check("alert_definitions_version_positive", sql`${table.version} > 0`),
    check(
      "alert_definitions_failures_nonnegative",
      sql`${table.consecutiveFailures} >= 0`,
    ),
    check(
      "alert_definitions_row_count_nonnegative",
      sql`${table.lastRowCount} >= 0`,
    ),
    check(
      "alert_definitions_firing_count_nonnegative",
      sql`${table.firingInstanceCount} >= 0`,
    ),
    // Live identity is the global address (org, project, slug); `repoid` owns
    // (reconcile scope), not identity. Preview identity via the parent.
    uniqueIndex("alert_definitions_live_project_slug_uq")
      .on(table.organizationId, table.project, table.slug)
      .where(sql`${table.previewId} IS NULL`),
    uniqueIndex("alert_definitions_preview_project_slug_uq")
      .on(table.previewId, table.project, table.slug)
      .where(sql`${table.previewId} IS NOT NULL`),
    uniqueIndex("alert_definitions_org_id_uq").on(
      table.organizationId,
      table.id,
    ),
    index("alert_definitions_due_idx").on(table.active, table.nextEvaluationAt),
    // Backs listRulesPage's ORDER BY updated_at DESC, id DESC per org: every
    // `everr apply` walks the full listing in 500-row pages.
    index("alert_definitions_org_updated_idx").on(
      table.organizationId,
      sql`updated_at DESC`,
      sql`id DESC`,
    ),
  ],
);

export const alertInstances = pgTable(
  "alert_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    alertDefinitionId: uuid("alert_definition_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: alertInstanceStateEnum("status").notNull().default("inactive"),
    labels: jsonb("labels")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, string>>(),
    evidence: jsonb("evidence")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    value: doublePrecision("value"),
    pendingSince: timestamp("pending_since", { withTimezone: true }),
    activeSince: timestamp("active_since", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    absentCount: integer("absent_count").notNull().default(0),
    // The open episode, so the evaluator can stamp every lifecycle row of one
    // incident with the same id. Null while the instance is inactive, and null
    // on rows written before the writers exist, so no foreign key.
    episodeId: uuid("episode_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.alertDefinitionId],
      foreignColumns: [alertDefinitions.organizationId, alertDefinitions.id],
      name: "alert_instances_definition_tenant_fk",
    }).onDelete("cascade"),
    check(
      "alert_instances_absent_count_nonnegative",
      sql`${table.absentCount} >= 0`,
    ),
    uniqueIndex("alert_instances_definition_fingerprint_uq").on(
      table.alertDefinitionId,
      table.fingerprint,
    ),
    // Backs the retention sweep: it selects the oldest inactive rows across
    // every organization, so the index cannot lead on organization_id.
    index("alert_instances_inactive_updated_idx")
      .on(table.updatedAt, table.id)
      .where(sql`${table.status} = 'inactive'`),
  ],
);

export const alertEvaluations = pgTable(
  "alert_evaluations",
  {
    alertDefinitionId: uuid("alert_definition_id")
      .notNull()
      .references(() => alertDefinitions.id, { onDelete: "cascade" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.alertDefinitionId, table.scheduledFor] }),
    index("alert_evaluations_scheduled_idx").on(table.scheduledFor),
  ],
);

export const alertEvents = pgTable(
  "alert_events",
  {
    // UUIDv7, not drizzle's `defaultRandom()`: the id sorts by creation time,
    // which is what makes an id range a time bound on the projected history.
    // Minted by `uuidv7()` in data/alerting/history/ids.ts, never by the
    // database: the writer needs the id before the insert, to stamp the same
    // value onto `episode_id` and onto the projected ClickHouse row. A
    // database default would also pin us to Postgres 18, which our managed
    // provider does not offer.
    id: uuid("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    repoid: text("repoid").notNull(),
    previewId: uuid("preview_id"),
    sourceDefinitionId: uuid("source_definition_id").notNull(),
    slug: text("slug").notNull(),
    eventType: alertEventTypeEnum("event_type").notNull(),
    kind: alertEventKindEnum("kind").notNull().default("notifying"),
    // The episode this lifecycle row belongs to: the id of the row that opened
    // it. Null on rows that belong to no episode (evaluation and hold rows).
    episodeId: uuid("episode_id"),
    // Why a terminal row ended its instance: condition_cleared on a resolve;
    // pending_cleared, labels_changed, rule_paused or rule_deleted on
    // instance_closed. The
    // journal carries it so a repaired projection recovers it. Branded to the
    // closed vocabulary so a writer cannot journal a reason no reader labels.
    reason: text("reason")
      .notNull()
      .default("")
      .$type<AlertingLifecycleReason | "">(),
    instanceFingerprint: text("instance_fingerprint").notNull().default(""),
    instanceLabels: jsonb("instance_labels")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, string>>(),
    severity: alertSeverityEnum("severity").notNull().default("info"),
    notificationTitle: text("notification_title").notNull().default(""),
    notificationDescription: text("notification_description")
      .notNull()
      .default(""),
    suppressed: boolean("suppressed").notNull().default(false),
    // The silence holding this event, while it is held; a terminal write
    // clears it. "Was this ever silenced" lives in the ClickHouse history,
    // not here.
    silenceId: uuid("silence_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.previewId, table.organizationId, table.repoid],
      foreignColumns: [previews.id, previews.organizationId, previews.repoid],
      name: "alert_events_preview_tenant_fk",
    }).onDelete("cascade"),
    check("alert_events_repoid_nonempty", sql`length(${table.repoid}) > 0`),
    // The born-processed boundary rests on kind agreeing with event_type: the
    // delivery reads select kind = 'notifying', and kind defaults to it, so a
    // state-stream row journaled by a writer that forgot the field becomes a
    // notification candidate. Every event type falls on exactly one side.
    check(
      "alert_events_kind_matches_type",
      sql`(${table.eventType} NOT IN ('instance_pending', 'instance_closed', 'evaluation_failed') OR ${table.kind} = 'state') AND (${table.eventType} NOT IN ('instance_fired', 'instance_resolved') OR ${table.kind} = 'notifying')`,
    ),
    // Enforces the closed reason vocabulary the `reason` column comment
    // promises: derived from ALERTING_LIFECYCLE_REASONS so a reason added
    // there without a matching migration is caught at write time, not
    // silently blanked by a reader that doesn't recognize it.
    check(
      "alert_events_reason_in_vocabulary",
      sql`${table.reason} IN (${sql.raw(ALERT_EVENTS_REASON_VOCABULARY_SQL)})`,
    ),
    index("alert_events_org_occurred_idx").on(
      table.organizationId,
      sql`occurred_at DESC`,
    ),
    index("alert_events_org_fingerprint_idx").on(
      table.organizationId,
      table.instanceFingerprint,
      sql`occurred_at DESC`,
    ),
    index("alert_events_org_slug_idx").on(
      table.organizationId,
      table.slug,
      sql`occurred_at DESC`,
    ),
    index("alert_events_processed_idx")
      .on(table.processedAt, table.id)
      .where(sql`${table.processedAt} IS NOT NULL`),
    // Cancelling a silence releases the events it holds; held rows are the
    // tiny unprocessed set, so the complement of the processed_idx predicate
    // keeps that lookup off the full journal.
    index("alert_events_held_silence_idx")
      .on(table.silenceId)
      .where(
        sql`${table.processedAt} IS NULL AND ${table.silenceId} IS NOT NULL`,
      ),
    // Backs cancelableNotifyingEventsFilter: every pause, delete and label
    // change scans a rule's own unprocessed events inside the mutation's
    // transaction. Same shape as alert_events_held_silence_idx: the
    // unprocessed set is tiny next to the full journal.
    index("alert_events_cancelable_idx")
      .on(table.organizationId, table.sourceDefinitionId)
      .where(sql`${table.processedAt} IS NULL`),
    uniqueIndex("alert_events_org_id_uq").on(table.organizationId, table.id),
  ],
);

export const alertSilences = pgTable(
  "alert_silences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    matchers: jsonb("matchers")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<AlertingMatcher[]>(),
    comment: text("comment").notNull().default(""),
    author: text("author").notNull().default(""),
    // The stable identity behind `author` (`user:<id>`, `apikey:<id>`,
    // `system`). `author` holds the display at creation time, which is
    // self-editable profile data; this is what the audit trail attributes to.
    authorPrincipal: text("author_principal").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set when a user cancels the silence rather than letting it run out.
    // Cancelling collapses the window, so without this the two endings are
    // indistinguishable, and only one of them is somebody's decision.
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (table) => [
    // Cancelling a silence that has not started yet collapses it to zero
    // length, so the window is closed rather than strictly positive. Creation
    // still rejects an empty window; see createSilence.
    check(
      "alert_silences_valid_window",
      sql`${table.endsAt} >= ${table.startsAt}`,
    ),
    index("alert_silences_active_lookup_idx").on(
      table.organizationId,
      table.endsAt,
    ),
    index("alert_silences_cleanup_idx").on(table.endsAt, table.id),
  ],
);

export const alertChannels = pgTable(
  "alert_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    encryptedConfig: text("encrypted_config").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_channels_org_name_uq").on(
      table.organizationId,
      table.name,
    ),
    uniqueIndex("alert_channels_org_id_uq").on(table.organizationId, table.id),
  ],
);

// The org-level default destination: where alerts deliver when their rule
// names no channels of its own. Tier "all" is the unsplit mode; the per
// severity tiers exist only when the org opted into splitting. App logic
// keeps the two modes exclusive, since a cross-row constraint cannot.
export const alertDefaultChannels = pgTable(
  "alert_default_channels",
  {
    organizationId: text("organization_id").notNull(),
    tier: text("tier", {
      enum: ["all", "critical", "warning", "info"],
    }).notNull(),
    channelId: uuid("channel_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.tier, table.channelId],
    }),
    foreignKey({
      columns: [table.organizationId, table.channelId],
      foreignColumns: [alertChannels.organizationId, alertChannels.id],
      // A channel delete quietly leaves the default; the UI warns when the
      // delete empties a tier.
    }).onDelete("cascade"),
    index("alert_default_channels_channel_idx").on(table.channelId),
  ],
);

export const alertNotificationGroups = pgTable(
  "alert_notification_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    groupKey: text("group_key").notNull(),
    // Which default-destination tier this group delivers to, or null for a
    // group created by a rule's own channels. Channels resolve at flush, so
    // a default edited mid-wait delivers to the current config.
    defaultTier: text("default_tier", {
      enum: ["all", "critical", "warning", "info"],
    }),
    directAlertDefinitionId: uuid("direct_alert_definition_id"),
    nextFlushAt: timestamp("next_flush_at", { withTimezone: true }).notNull(),
    lastFlushedAt: timestamp("last_flushed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.directAlertDefinitionId],
      foreignColumns: [alertDefinitions.organizationId, alertDefinitions.id],
      name: "alert_notification_groups_direct_definition_tenant_fk",
    }).onDelete("cascade"),
    uniqueIndex("alert_notification_groups_org_key_uq").on(
      table.organizationId,
      table.groupKey,
    ),
    uniqueIndex("alert_notification_groups_org_id_uq").on(
      table.organizationId,
      table.id,
    ),
    check(
      "alert_notification_groups_one_target",
      sql`num_nonnulls(${table.defaultTier}, ${table.directAlertDefinitionId}) = 1`,
    ),
    index("alert_notification_groups_cleanup_idx").on(
      table.updatedAt,
      table.id,
    ),
    // Backs orphanedDirectChainsFilter: a rule delete scans its own direct
    // groups inside the mutation's transaction, with no index on the FK
    // column otherwise.
    index("alert_notification_groups_direct_definition_idx").on(
      table.organizationId,
      table.directAlertDefinitionId,
    ),
  ],
);

export const alertNotificationGroupEvents = pgTable(
  "alert_notification_group_events",
  {
    organizationId: text("organization_id").notNull(),
    groupId: uuid("group_id").notNull(),
    eventId: uuid("event_id").notNull(),
    // Null until a flush has carried this membership into a notification.
    // Durable progress: a clock comparison against the group's last flush
    // discarded events that joined the group after they occurred.
    flushedAt: timestamp("flushed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.eventId] }),
    foreignKey({
      columns: [table.organizationId, table.groupId],
      foreignColumns: [
        alertNotificationGroups.organizationId,
        alertNotificationGroups.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [alertEvents.organizationId, alertEvents.id],
    }).onDelete("cascade"),
    index("alert_notification_group_events_event_idx").on(table.eventId),
  ],
);

export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    dedupKey: text("dedup_key").primaryKey(),
    organizationId: text("organization_id").notNull(),
    notificationGroupId: uuid("notification_group_id").references(
      () => alertNotificationGroups.id,
      { onDelete: "set null" },
    ),
    // Nullable, and cleared by deleteChannel before it removes the channel:
    // the row is the record of a notification, not a reference to live config.
    // `channel_name` carries the channel's identity for a reader, and the
    // ClickHouse history carries it again, so a delete costs the trail
    // nothing. Only the send path needs the channel itself, and only until the
    // delivery reaches a terminal state. The clearing is explicit rather than
    // ON DELETE SET NULL because this foreign key is composite: Postgres would
    // null organization_id along with it, and that column is NOT NULL.
    channelId: uuid("channel_id"),
    channelName: text("channel_name").notNull(),
    notification: jsonb("notification")
      .notNull()
      .$type<{ title: string; body: string; url?: string }>(),
    status: alertDeliveryStateEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.channelId],
      foreignColumns: [alertChannels.organizationId, alertChannels.id],
      name: "alert_deliveries_channel_tenant_fk",
    }),
    check("alert_deliveries_attempts_nonnegative", sql`${table.attempts} >= 0`),
    // Backs deleteChannel's reference check. Partial on the in-flight rows,
    // the only ones that block a delete: the terminal rows for a busy channel
    // outnumber them by the whole retention window, and scanning those to
    // answer "is anything still sending" is the cost this predicate removes.
    index("alert_deliveries_org_channel_inflight_idx")
      .on(table.organizationId, table.channelId)
      .where(
        sql`${table.status} = 'pending' OR (${table.status} = 'failed' AND ${table.attempts} < 5)`,
      ),
    index("alert_deliveries_terminal_cleanup_idx")
      .on(table.updatedAt, table.dedupKey)
      .where(
        sql`${table.status} = 'sent' OR (${table.status} = 'failed' AND ${table.attempts} >= 5)`,
      ),
    uniqueIndex("alert_deliveries_org_key_uq").on(
      table.organizationId,
      table.dedupKey,
    ),
  ],
);

export const alertDeliveryEvents = pgTable(
  "alert_delivery_events",
  {
    organizationId: text("organization_id").notNull(),
    deliveryDedupKey: text("delivery_dedup_key").notNull(),
    eventId: uuid("event_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deliveryDedupKey, table.eventId] }),
    foreignKey({
      columns: [table.organizationId, table.deliveryDedupKey],
      foreignColumns: [
        alertDeliveries.organizationId,
        alertDeliveries.dedupKey,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [alertEvents.organizationId, alertEvents.id],
    }).onDelete("cascade"),
    index("alert_delivery_events_event_idx").on(table.eventId),
  ],
);
