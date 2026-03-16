import { relations, sql } from "drizzle-orm";
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
} from "drizzle-orm/pg-core";

export const tenants = pgTable(
  "tenants",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("tenants_external_id_uq").on(table.externalId)],
);

export const githubInstallationStatusEnum = pgEnum("installation_status", [
  "active",
  "suspended",
  "uninstalled",
]);

export const githubInstallationTenants = pgTable(
  "github_installation_tenants",
  {
    githubInstallationId: bigint("github_installation_id", {
      mode: "number",
    }).primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    status: githubInstallationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("github_installation_tenants_tenant_id_idx").on(table.tenantId),
  ],
);

export const tenantRelations = relations(tenants, ({ many }) => ({
  githubInstallations: many(githubInstallationTenants),
}));

export const githubInstallationTenantRelations = relations(
  githubInstallationTenants,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [githubInstallationTenants.tenantId],
      references: [tenants.id],
    }),
  }),
);

export const accessTokens = pgTable(
  "access_tokens",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("access_tokens_token_hash_uq").on(table.tokenHash),
    index("access_tokens_org_user_revoked_created_idx").on(
      table.organizationId,
      table.userId,
      table.revokedAt,
      table.createdAt,
    ),
    index("access_tokens_token_prefix_idx").on(table.tokenPrefix),
    index("access_tokens_revoked_expires_idx").on(
      table.revokedAt,
      table.expiresAt,
    ),
  ],
);

export const cliDeviceAuthorizationStatusEnum = pgEnum(
  "cli_device_authorization_status",
  ["pending", "approved", "denied", "consumed", "expired"],
);

export const cliDeviceAuthorizations = pgTable(
  "cli_device_authorizations",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    deviceCodeHash: text("device_code_hash").notNull(),
    userCode: text("user_code").notNull(),
    status: cliDeviceAuthorizationStatusEnum("status")
      .notNull()
      .default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(5),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    approvedByUserId: text("approved_by_user_id"),
    approvedForOrganizationId: text("approved_for_organization_id"),
    approvedForTenantId: bigint("approved_for_tenant_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("cli_device_authorizations_device_code_hash_uq").on(
      table.deviceCodeHash,
    ),
    uniqueIndex("cli_device_authorizations_user_code_uq").on(table.userCode),
    index("cli_device_authorizations_status_expires_idx").on(
      table.status,
      table.expiresAt,
    ),
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
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
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
      table.tenantId,
      table.runId,
      table.attempts,
    ),
    uniqueIndex("workflow_runs_tenant_trace_id_uq").on(
      table.tenantId,
      table.traceId,
    ),
    index("workflow_runs_tenant_repo_ref_sha_idx").on(
      table.tenantId,
      table.repository,
      table.ref,
      table.sha,
    ),
  ],
);

export type WorkflowJobMetadata = {
  runner_name?: string;
  runner_labels?: string[];
  runner_group_name?: string;
  workflow_name?: string;
  html_url?: string;
};

export const workflowJobs = pgTable(
  "workflow_jobs",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
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
    uniqueIndex("workflow_jobs_tenant_job_uq").on(table.tenantId, table.jobId),
    index("workflow_jobs_tenant_trace_id_idx").on(
      table.tenantId,
      table.traceId,
    ),
  ],
);
