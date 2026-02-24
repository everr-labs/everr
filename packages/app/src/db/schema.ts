import { relations } from "drizzle-orm";
import {
  bigint,
  index,
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

export const mcpTokens = pgTable(
  "mcp_tokens",
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mcp_tokens_token_hash_uq").on(table.tokenHash),
    index("mcp_tokens_org_user_revoked_created_idx").on(
      table.organizationId,
      table.userId,
      table.revokedAt,
      table.createdAt,
    ),
    index("mcp_tokens_token_prefix_idx").on(table.tokenPrefix),
  ],
);
