import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { CompanyRecord } from "../../crm/brevo/adapter";
import type { DesiredProjection } from "../../crm/snapshots";

/** Deliberately no source FKs: entity and association cleanup survives cascades. */
export const crmProjection = pgTable(
  "crm_projection",
  {
    deployment: text("deployment").notNull(),
    kind: text("kind", { enum: ["user", "organization", "membership"] }).notNull(),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    userId: text("user_id"),
    organizationId: text("organization_id"),
    remoteId: text("remote_id"),
    // Intent survives crashes and desired revisions. Only a definitive unsent deferral clears it.
    companyCreateAttemptedAt: timestamp("company_create_attempted_at", { withTimezone: true }),
    // A successful GET is durable so the next general permit can perform PATCH.
    companyRead: jsonb("company_read").$type<CompanyRecord>(),
    // Fresh ownership read for cleanup, separate from an earlier upsert read.
    cleanupCompanyRead: jsonb("cleanup_company_read").$type<CompanyRecord>(),
    // Association endpoint IDs remain available even after source cascades.
    remoteContactId: text("remote_contact_id"),
    remoteCompanyId: text("remote_company_id"),
    desired: jsonb("desired").$type<DesiredProjection>().notNull(),
    desiredRevision: integer("desired_revision").default(1).notNull(),
    remoteCheckId: text("remote_check_id"),
    syncedRevision: integer("synced_revision"),
    retryFailures: integer("retry_failures").default(0).notNull(),
    outcome: text("outcome", { enum: ["pending", "synced", "failed", "blocked"] })
      .default("pending")
      .notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    pendingSince: timestamp("pending_since", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deployment, table.kind, table.sourceId] }),
    uniqueIndex("crm_projection_external_id_uidx").on(table.externalId),
    uniqueIndex("crm_projection_remote_id_uidx").on(table.deployment, table.kind, table.remoteId),
    check(
      "crm_projection_kind_check",
      sql`${table.kind} in ('user', 'organization', 'membership')`,
    ),
    check(
      "crm_projection_endpoints_check",
      sql`
    (${table.kind} = 'user' and ${table.userId} = ${table.sourceId} and ${table.userId} is not null and ${table.organizationId} is null)
    or (${table.kind} = 'organization' and ${table.organizationId} = ${table.sourceId} and ${table.organizationId} is not null and ${table.userId} is null)
    or (${table.kind} = 'membership' and ${table.userId} is not null and ${table.organizationId} is not null)
  `,
    ),
    check(
      "crm_projection_revision_check",
      sql`${table.desiredRevision} > 0 and (${table.syncedRevision} is null or ${table.syncedRevision} <= ${table.desiredRevision})`,
    ),
    check("crm_projection_retry_failures_check", sql`${table.retryFailures} >= 0`),
  ],
);

/** Account-wide outbound limits, deliberately independent of deployment and API-key rotation. */
export const crmBrevoBudget = pgTable(
  "crm_brevo_budget",
  {
    accountScope: text("account_scope").notNull(),
    group: text("endpoint_group", { enum: ["contacts", "general"] }).notNull(),
    nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountScope, table.group] }),
    check("crm_brevo_budget_group_check", sql`${table.group} in ('contacts', 'general')`),
  ],
);

/** Admission progress only. No source FKs or historical lifecycle facts. */
export const crmBootstrap = pgTable(
  "crm_bootstrap",
  {
    deployment: text("deployment").notNull(),
    accountScope: text("account_scope").notNull(),
    scanId: text("scan_id").notNull(),
    phase: text("phase", {
      enum: ["user", "organization", "member", "projection", "completed"],
    }).notNull(),
    cursor: text("cursor"),
    cursorKind: text("cursor_kind"),
    admitted: integer("admitted").default(0).notNull(),
    pages: integer("pages").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deployment, table.accountScope] }),
    check(
      "crm_bootstrap_phase_check",
      sql`${table.phase} in ('user', 'organization', 'member', 'projection', 'completed')`,
    ),
    check("crm_bootstrap_progress_check", sql`${table.admitted} >= 0 and ${table.pages} >= 0`),
  ],
);

/** Separate periodic progress, so an operator bootstrap never resets a repair cycle. */
export const crmReconciliation = pgTable(
  "crm_reconciliation",
  {
    deployment: text("deployment").notNull(),
    accountScope: text("account_scope").notNull(),
    scanId: text("scan_id").notNull(),
    phase: text("phase", {
      enum: ["user", "organization", "member", "projection", "completed"],
    }).notNull(),
    cursor: text("cursor"),
    cursorKind: text("cursor_kind"),
    admitted: integer("admitted").default(0).notNull(),
    pages: integer("pages").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.deployment, table.accountScope] })],
);
