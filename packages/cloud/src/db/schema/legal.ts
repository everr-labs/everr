import { user } from "@everr/app/db/schema";
import { pgTable, text } from "drizzle-orm/pg-core";

// Initial acceptance only. Its timestamp is the linked user's createdAt.
export const userTerms = pgTable("user_terms", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  termsHash: text("terms_hash").notNull(),
});
