import { sql } from "drizzle-orm";
import {
  bigint,
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
import type { Dashboard } from "@/data/dashboards/schema";
import type { Notebook } from "@/data/notebooks/schema";

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

export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    // Perses project namespace that owns this dashboard (identity + prune
    // scope). Denormalized from the document's metadata.project (default
    // "default") so identity/indexing never reads from JSONB.
    project: text("project").notNull(),
    // URL-safe per-project identifier (the document's metadata.name, or the
    // filename when that's absent). Part of the identity tuple below.
    slug: text("slug").notNull(),
    // Derived display path ("Team / Latency"); empty string = root. Comes from
    // the file's directory tree, not the document, so it's stored separately.
    folderPath: text("folder_path").notNull().default(""),
    // The whole Perses document, stored verbatim so unknown fields survive a
    // read/apply round-trip. Identity/index data (project, slug, folderPath)
    // lives in dedicated columns above.
    document: jsonb("document").notNull().$type<Dashboard>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Identity is (org, project, slug): same-named dashboards in different
    // projects coexist; an in-project duplicate is rejected.
    uniqueIndex("dashboards_tenant_project_slug_uq").on(
      table.organizationId,
      table.project,
      table.slug,
    ),
    index("dashboards_tenant_updated_idx").on(
      table.organizationId,
      sql`updated_at DESC`,
    ),
  ],
);

export const notebooks = pgTable(
  "notebooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    // Perses project namespace that owns this notebook (identity + prune
    // scope), denormalized from metadata.project like dashboards.
    project: text("project").notNull(),
    slug: text("slug").notNull(),
    folderPath: text("folder_path").notNull().default(""),
    // The whole document, stored verbatim so unknown fields survive a
    // read/apply round-trip. Markdown is always inlined by the CLI.
    document: jsonb("document").notNull().$type<Notebook>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("notebooks_tenant_project_slug_uq").on(
      table.organizationId,
      table.project,
      table.slug,
    ),
    index("notebooks_tenant_updated_idx").on(
      table.organizationId,
      sql`updated_at DESC`,
    ),
  ],
);
