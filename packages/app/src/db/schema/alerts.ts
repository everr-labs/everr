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

export const alertStateEnum = pgEnum("alert_state", [
  "unknown",
  "resolved",
  "firing",
]);

export type AlertDeliverySettings = {
  email?: { enabled: boolean; to: string[] };
  telegram?: { enabled: boolean; chatIds: string[] };
};

export const alertDefinitions = pgTable(
  "alert_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    repoid: text("repoid").notNull(),
    slug: text("slug").notNull(),
    evaluationIntervalSeconds: integer("evaluation_interval_seconds").notNull(),
    window: text("window").notNull(),
    rawYaml: text("raw_yaml").notNull(),
    parsedQuery: text("parsed_query").notNull(),
    summaryTemplate: text("summary_template").notNull(),
    descriptionTemplate: text("description_template").notNull().default(""),
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
    active: boolean("active").notNull().default(true),
    validationStatus: text("validation_status").notNull().default("valid"),
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
  delivery: jsonb("delivery").notNull().$type<AlertDeliverySettings>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AlertSilenceMatcher = {
  label: string;
  op: "=" | "!=" | "=~" | "!~";
  value: string;
};

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
      .$type<AlertSilenceMatcher[]>(),
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
    index("alert_silences_active_lookup_idx").on(
      table.organizationId,
      table.alertDefinitionId,
      table.endsAt,
    ),
  ],
);
