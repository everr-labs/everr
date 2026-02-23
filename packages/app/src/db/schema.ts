import { relations } from "drizzle-orm";
import {
  bigint,
  index,
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

export const githubInstallationTenants = pgTable(
  "github_installation_tenants",
  {
    githubInstallationId: bigint("github_installation_id", {
      mode: "number",
    }).primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
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
