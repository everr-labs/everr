import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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
import type { Runbook } from "@/data/runbooks/schema";

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
    // Live rows carry `repoid` (the apply/prune boundary) and no preview parent.
    // Preview rows carry `previewId` and derive repoid/name from the `previews`
    // row; the CHECK below enforces exactly one of the two. ON DELETE CASCADE
    // means retention deleting a preview also removes its resource rows.
    repoid: text("repoid"),
    previewId: uuid("preview_id").references(() => previews.id, {
      onDelete: "cascade",
    }),
    // Perses project namespace inside the repository. Denormalized from the
    // document's metadata.project (default "default") so identity/indexing
    // never reads from JSONB.
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
    // Every row is exactly one of: live (repoid set, no parent) or preview
    // (parent set, no repoid).
    check(
      "dashboards_live_xor_preview",
      sql`(${table.previewId} IS NULL) <> (${table.repoid} IS NULL)`,
    ),
    // Live identity is the global address (org, project, slug); `repoid` is the
    // owning repo (reconcile scope + provenance), NOT part of identity — two
    // repos can't both hold the same live (project, slug). Preview identity:
    // repoid/name are implied by the parent, so (preview_id, project, slug) fits.
    uniqueIndex("dashboards_live_project_slug_uq")
      .on(table.organizationId, table.project, table.slug)
      .where(sql`${table.previewId} IS NULL`),
    uniqueIndex("dashboards_preview_project_slug_uq")
      .on(table.previewId, table.project, table.slug)
      .where(sql`${table.previewId} IS NOT NULL`),
    index("dashboards_tenant_updated_idx").on(
      table.organizationId,
      sql`updated_at DESC`,
    ),
  ],
);

export const runbooks = pgTable(
  "runbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    // Live/preview split mirrors dashboards: live rows carry `repoid`, preview
    // rows carry `previewId` (cascade-deleted with the preview). See the CHECK.
    repoid: text("repoid"),
    previewId: uuid("preview_id").references(() => previews.id, {
      onDelete: "cascade",
    }),
    // Perses project namespace that owns this runbook (identity), denormalized
    // from metadata.project like dashboards.
    project: text("project").notNull(),
    slug: text("slug").notNull(),
    folderPath: text("folder_path").notNull().default(""),
    // The whole document, stored verbatim so unknown fields survive a
    // read/apply round-trip. Markdown is always inlined by the CLI.
    document: jsonb("document").notNull().$type<Runbook>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "runbooks_live_xor_preview",
      sql`(${table.previewId} IS NULL) <> (${table.repoid} IS NULL)`,
    ),
    // Live identity is the global address (org, project, slug); `repoid` owns
    // (reconcile scope), not identity. Preview identity via the parent.
    uniqueIndex("runbooks_live_project_slug_uq")
      .on(table.organizationId, table.project, table.slug)
      .where(sql`${table.previewId} IS NULL`),
    uniqueIndex("runbooks_preview_project_slug_uq")
      .on(table.previewId, table.project, table.slug)
      .where(sql`${table.previewId} IS NOT NULL`),
    index("runbooks_tenant_updated_idx").on(
      table.organizationId,
      sql`updated_at DESC`,
    ),
  ],
);

/**
 * Registry of applied previews: one row per (org, repoid, preview name).
 * Powers the web app's preview switcher (which repoids a preview covers is
 * the overlay boundary) and the retention job. `lastAppliedAt` is touched on
 * every apply; rows older than the retention window are hard-deleted along
 * with their resource rows.
 */
export const previews = pgTable(
  "previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
    repoid: text("repoid").notNull(),
    // Raw preview name (usually a git branch, e.g. "gio/desktop-app"),
    // stored verbatim; URL-encoded only at the edges.
    name: text("name").notNull(),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("previews_tenant_repo_name_uq").on(
      table.organizationId,
      table.repoid,
      table.name,
    ),
  ],
);

// Orgs whose preview-owned CC rules/SLOs could not be cleaned up when their
// preview registry rows were deleted (CC unreachable or the delete failed).
// The orphan sweep visits these orgs IN ADDITION to orgs that still hold
// preview rows, then clears the marker once a pass completes cleanly; without
// it, an org whose LAST preview died during a CC outage would never be
// visited again and its suppressed rules would evaluate forever.
export const ccCleanupPending = pgTable("cc_cleanup_pending", {
  organizationId: text("organization_id").primaryKey(),
  firstFailedAt: timestamp("first_failed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
