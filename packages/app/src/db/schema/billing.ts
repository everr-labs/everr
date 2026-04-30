import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
