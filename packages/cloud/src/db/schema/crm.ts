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
    // Association endpoint IDs remain available even after source cascades.
    remoteContactId: text("remote_contact_id"),
    remoteCompanyId: text("remote_company_id"),
    desired: jsonb("desired").$type<DesiredProjection>().notNull(),
    desiredFingerprint: text("desired_fingerprint").notNull(),
    desiredRevision: integer("desired_revision").default(1).notNull(),
    syncedRevision: integer("synced_revision"),
    syncedFingerprint: text("synced_fingerprint"),
    outcome: text("outcome", { enum: ["pending", "synced", "failed", "blocked"] })
      .default("pending")
      .notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
  ],
);
