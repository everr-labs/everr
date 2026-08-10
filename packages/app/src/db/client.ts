import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { dbEnv } from "@/env/db";

const shouldUseSsl = ["true", "1", "yes", "on"].includes(
  dbEnv.DATABASE_SSL?.toLowerCase() ?? "",
);

export const pool = new Pool({
  host: dbEnv.DATABASE_HOST,
  database: dbEnv.DATABASE_NAME,
  port: dbEnv.DATABASE_PORT,
  user: dbEnv.DATABASE_USER,
  password: dbEnv.DATABASE_PASSWORD,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  // pg's default is 0: wait forever. Under pool exhaustion (for example a
  // hold-and-acquire bug) that turns an error spike into a permanent
  // whole-app hang; a bounded wait fails the request loudly instead.
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
/** The `tx` handle inside `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/**
 * Anything that can run queries: the base pool or an open transaction. Reconcilers
 * take one so the whole apply (register + every kind) commits or rolls back as a
 * unit; dry-run reads pass the base `db`.
 */
export type DbExecutor = Database | Transaction;
