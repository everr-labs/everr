import { sql } from "drizzle-orm";
import {
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

export const orgSubscription = pgTable("org_subscription", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  polarSubscriptionId: text("polar_subscription_id").notNull(),
  polarProductId: text("polar_product_id").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  polarModifiedAt: timestamp("polar_modified_at").notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// The ID is reserved before payment, so it deliberately has no organization FK.
export const proOrganizationCheckout = pgTable(
  "pro_organization_checkout",
  {
    orgId: text("org_id").primaryKey(),
    // Historical creator identity must survive account deletion for webhook verification.
    ownerId: text("owner_id").notNull(),
    organizationName: text("organization_name").notNull(),
    organizationSlug: text("organization_slug").notNull().unique(),
    checkoutId: text("checkout_id"),
    polarCustomerId: text("polar_customer_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    uniqueIndex("pro_organization_checkout_pending_owner_name_uidx")
      .on(table.ownerId, table.organizationName)
      .where(sql`${table.completedAt} is null`),
  ],
);
