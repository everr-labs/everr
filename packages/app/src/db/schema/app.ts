import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const githubInstallationStatusEnum = pgEnum("installation_status", [
  "active",
  "suspended",
  "uninstalled",
]);

export const githubInstallationOrganizations = pgTable(
  "github_installation_organizations",
  {
    githubInstallationId: bigint("github_installation_id", {
      mode: "number",
    }).primaryKey(),
    organizationId: text("organization_id").notNull(),
    status: githubInstallationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("github_installation_orgs_org_id_idx").on(table.organizationId),
  ],
);

export const workflowStatusEnum = pgEnum("workflow_status", [
  "requested",
  "waiting",
  "queued",
  "in_progress",
  "completed",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "critical",
  "warning",
]);

export const alertStateStatusEnum = pgEnum("alert_state_status", [
  "inactive",
  "firing",
  "resolved",
]);

export const alertEventTypeEnum = pgEnum("alert_event_type", [
  "firing",
  "resolved",
  "evaluation_failed",
]);

export type WorkflowRunMetadata = {
  event?: string;
  workflow_id?: number;
  display_title?: string;
  head_commit_message?: string;
  run_number?: number;
  path?: string;
  actor?: string;
  triggering_actor?: string;
  pull_requests?: number[];
  head_repository?: string;
  html_url?: string;
};

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    organizationId: text("organization_id").notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    attempts: integer("attempts").notNull().default(1),
    traceId: text("trace_id").notNull(),
    workflowName: text("workflow_name").notNull(),
    repository: text("repository").notNull(),
    sha: text("sha").notNull(),
    ref: text("ref").notNull(),
    status: workflowStatusEnum("status").notNull(),
    conclusion: text("conclusion"),
    authorEmail: text("author_email"),
    startedAt: timestamp("run_started_at", { withTimezone: true }),
    completedAt: timestamp("run_completed_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<WorkflowRunMetadata>(),
    // These reflect our own write times, not GitHub event timestamps.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_runs_tenant_run_attempts_uq").on(
      table.organizationId,
      table.runId,
      table.attempts,
    ),
    uniqueIndex("workflow_runs_tenant_trace_id_uq").on(
      table.organizationId,
      table.traceId,
    ),
    index("workflow_runs_tenant_repo_sha_ref_idx").on(
      table.organizationId,
      table.repository,
      table.sha,
      table.ref,
    ),
    index("workflow_runs_tenant_last_event_idx").on(
      table.organizationId,
      sql`last_event_at DESC`,
    ),
  ],
);

export type WorkflowJobStep = {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
};

export type WorkflowJobMetadata = {
  runner_name?: string;
  runner_labels?: string[];
  runner_group_name?: string;
  workflow_name?: string;
  html_url?: string;
  steps?: WorkflowJobStep[];
};

export const workflowJobs = pgTable(
  "workflow_jobs",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    organizationId: text("organization_id").notNull(),
    jobId: bigint("job_id", { mode: "number" }).notNull(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    attempts: integer("attempts").notNull().default(1),
    traceId: text("trace_id").notNull(),
    jobName: text("job_name").notNull(),
    repository: text("repository").notNull(),
    sha: text("sha").notNull(),
    ref: text("ref").notNull(),
    status: workflowStatusEnum("status").notNull(),
    conclusion: text("conclusion"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<WorkflowJobMetadata>(),
    // These reflect our own write times, not GitHub event timestamps.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_jobs_tenant_job_uq").on(
      table.organizationId,
      table.jobId,
    ),
    index("workflow_jobs_tenant_trace_id_idx").on(
      table.organizationId,
      table.traceId,
    ),
  ],
);

export const alertDefinitions = pgTable(
  "alert_definitions",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    organizationId: text("organization_id").notNull(),
    service: text("service").notNull(),
    name: text("name").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    routingSlug: text("routing_slug").notNull(),
    evaluationIntervalSeconds: integer("evaluation_interval_seconds").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    nextEvaluationAt: timestamp("next_evaluation_at", {
      withTimezone: true,
    }).notNull(),
    scheduleJitterSeconds: integer("schedule_jitter_seconds")
      .notNull()
      .default(0),
    lastEnqueuedAt: timestamp("last_enqueued_at", { withTimezone: true }),
    rawYaml: text("raw_yaml").notNull(),
    query: text("query").notNull(),
    summaryTemplate: text("summary_template").notNull(),
    descriptionTemplate: text("description_template"),
    sourceUrl: text("source_url").notNull(),
    sourceRepo: text("source_repo"),
    sourceBranch: text("source_branch"),
    sourceCommitSha: text("source_commit_sha"),
    sourceRemote: text("source_remote"),
    sourcePath: text("source_path"),
    active: boolean("active").notNull().default(true),
    validationStatus: text("validation_status").notNull().default("valid"),
    lastEvaluationStatus: text("last_evaluation_status"),
    lastEvaluationError: text("last_evaluation_error"),
    createdByUserId: text("created_by_user_id").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_definitions_org_service_name_uq").on(
      table.organizationId,
      table.service,
      table.name,
    ),
    index("alert_definitions_due_idx").on(
      table.organizationId,
      table.active,
      table.nextEvaluationAt,
    ),
    index("alert_definitions_source_idx").on(
      table.organizationId,
      table.sourceUrl,
      table.service,
    ),
  ],
);

export const alertRoutingLists = pgTable(
  "alert_routing_lists",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    organizationId: text("organization_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_routing_lists_org_slug_uq").on(
      table.organizationId,
      table.slug,
    ),
  ],
);

export const alertRoutingListMembers = pgTable(
  "alert_routing_list_members",
  {
    routingListId: bigint("routing_list_id", { mode: "number" }).notNull(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_routing_list_members_list_user_uq").on(
      table.routingListId,
      table.userId,
    ),
  ],
);

export const alertStates = pgTable("alert_states", {
  alertDefinitionId: bigint("alert_definition_id", {
    mode: "number",
  }).primaryKey(),
  organizationId: text("organization_id").notNull(),
  status: alertStateStatusEnum("status").notNull().default("inactive"),
  firstFiredAt: timestamp("first_fired_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  rowCount: integer("row_count").notNull().default(0),
  evidence: jsonb("evidence")
    .$type<Array<Record<string, unknown>>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  evidenceTruncated: boolean("evidence_truncated").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alertEvents = pgTable(
  "alert_events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    alertDefinitionId: bigint("alert_definition_id", {
      mode: "number",
    }).notNull(),
    organizationId: text("organization_id").notNull(),
    type: alertEventTypeEnum("type").notNull(),
    evaluationScheduledFor: timestamp("evaluation_scheduled_for", {
      withTimezone: true,
    }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    summary: text("summary").notNull(),
    description: text("description"),
    rowCount: integer("row_count").notNull().default(0),
    evidence: jsonb("evidence")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    evidenceTruncated: boolean("evidence_truncated").notNull().default(false),
    errorMessage: text("error_message"),
  },
  (table) => [
    uniqueIndex("alert_events_definition_scheduled_type_uq").on(
      table.alertDefinitionId,
      table.evaluationScheduledFor,
      table.type,
    ),
    index("alert_events_org_occurred_idx").on(
      table.organizationId,
      sql`occurred_at DESC`,
    ),
  ],
);
