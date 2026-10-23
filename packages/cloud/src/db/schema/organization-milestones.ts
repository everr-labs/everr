import { organization } from "@everr/app/db/schema";
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Product markers are independent of CRM configuration. Source deletion removes them. */
export const organizationMilestones = pgTable(
  "organization_milestones",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    ruleVersion: integer("rule_version").notNull(),
    // Capability start for the process that first observed this Organization, not historical coverage.
    observerStartedAt: timestamp("observer_started_at", { withTimezone: true }).notNull(),
    firstQueryableAt: timestamp("first_queryable_at", { withTimezone: true }).notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull(),
    surface: text("surface", { enum: ["ui", "cli", "mcp"] }).notNull(),
  },
  (table) => [
    check("organization_milestones_rule_check", sql`${table.ruleVersion} = 1`),
    check("organization_milestones_surface_check", sql`${table.surface} in ('ui', 'cli', 'mcp')`),
    check(
      "organization_milestones_time_check",
      sql`${table.observerStartedAt} <= ${table.firstQueryableAt} and ${table.firstQueryableAt} = ${table.activatedAt}`,
    ),
  ],
);
