import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// The machine-only facts about an account, plus the parent row its secrets
// hang from. The organization and the name live on the `member` and `user`
// rows, the same as for a person, so there is no second answer to "which
// organization does this principal belong to?".
export const serviceAccount = pgTable(
  "service_account",
  {
    id: text("id").primaryKey(),
    // The synthetic user this account authenticates as. Deleting it removes
    // the member row too, which is how a service account loses all access.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (table) => [uniqueIndex("service_account_userId_uidx").on(table.userId)],
);

export const serviceAccountSecret = pgTable(
  "service_account_secret",
  {
    id: text("id").primaryKey(),
    serviceAccountId: text("service_account_id")
      .notNull()
      .references(() => serviceAccount.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    // First characters of the secret, so two secrets are tellable apart in the
    // UI without storing either one.
    start: text("start").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    // The exchange rate limit lives on the secret rather than in one app
    // process, so the bound is the same whatever number of instances serve
    // the request and whatever headers the caller sends.
    requestCount: integer("request_count").notNull().default(0),
    lastRequest: timestamp("last_request"),
  },
  (table) => [
    uniqueIndex("service_account_secret_hash_uidx").on(table.hash),
    index("service_account_secret_accountId_idx").on(table.serviceAccountId),
  ],
);

export const serviceAccountToken = pgTable(
  "service_account_token",
  {
    id: text("id").primaryKey(),
    serviceAccountSecretId: text("service_account_secret_id")
      .notNull()
      .references(() => serviceAccountSecret.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("service_account_token_hash_uidx").on(table.hash),
    index("service_account_token_secretId_idx").on(
      table.serviceAccountSecretId,
    ),
  ],
);
