import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { StoredDeliverySettings } from "@/data/alerts/delivery-settings";
import type { Matcher } from "@/data/alerts/matchers";
import type { AlertRuleYaml } from "@/data/alerts/schema";

export const alertStateEnum = pgEnum("alert_state", [
  "unknown",
  "resolved",
  "firing",
]);

export const alertDefinitions = pgTable(
  "alert_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    repoid: text("repoid").notNull(),
    slug: text("slug").notNull(),
    evaluationIntervalSeconds: integer("evaluation_interval_seconds").notNull(),
    document: jsonb("document").notNull().$type<AlertRuleYaml>(),
    parsedQuery: text("parsed_query").notNull(),
    notificationTitleTemplate: text("summary_template").notNull(),
    notificationDescriptionTemplate: text("description_template")
      .notNull()
      .default(""),
    nextEvaluationAt: timestamp("next_evaluation_at", { withTimezone: true }),
    scheduleJitterSeconds: integer("schedule_jitter_seconds")
      .notNull()
      .default(0),
    lastEnqueuedAt: timestamp("last_enqueued_at", { withTimezone: true }),
    configFilePath: text("config_file_path").notNull().default(""),
    sourceLink: text("source_link").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set when `apply` removes a rule from the config: the row is kept (so
    // history and events still resolve) but hidden from listings. Cleared when
    // the rule is re-applied.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    lastEvaluationStatus: text("last_evaluation_status").notNull().default(""),
    lastEvaluationError: text("last_evaluation_error").notNull().default(""),
    currentState: alertStateEnum("current_state").notNull().default("unknown"),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastRowCount: integer("last_row_count").notNull().default(0),
    lastEvidenceSnapshot: jsonb("last_evidence_snapshot")
      .notNull()
      .default(sql`'[]'::jsonb`),
    firingInstanceCount: integer("firing_instance_count").notNull().default(0),
    instanceLabelColumns: jsonb("instance_label_columns")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<string[]>(),
  },
  (table) => [
    uniqueIndex("alert_definitions_org_repo_slug_uq").on(
      table.organizationId,
      table.repoid,
      table.slug,
    ),
    index("alert_definitions_due_idx").on(table.active, table.nextEvaluationAt),
  ],
);

export const alertSettings = pgTable("alert_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().unique(),
  delivery: jsonb("delivery")
    .notNull()
    .$type<StoredDeliverySettings>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alertSilences = pgTable(
  "alert_silences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    alertDefinitionId: uuid("alert_definition_id")
      .notNull()
      .references(() => alertDefinitions.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull().default(""),
    matchers: jsonb("matchers")
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<Matcher[]>(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByUserId: text("cancelled_by_user_id"),
  },
  (table) => [
    index("alert_silences_active_lookup_idx")
      .on(table.organizationId, table.alertDefinitionId, table.endsAt)
      .where(sql`cancelled_at IS NULL`),
  ],
);
