import { drizzle } from "drizzle-orm/node-postgres";
import { PgTransaction } from "drizzle-orm/pg-core";
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

/**
 * Run `fn` atomically: a real transaction on the base pool, the transaction
 * itself when one is already open. Reusing instead of nesting matters: a
 * nested call opens a savepoint, every writing savepoint burns a
 * subtransaction id that RELEASE does not return, and past 64 in one
 * transaction every snapshot in the cluster degrades to pg_subtrans lookups.
 * The cost of reuse is that a failure aborts the whole open transaction,
 * which is what callers here want: the registry rolls the entire apply back
 * on any mutation failure anyway.
 */
export function runInTransaction<T>(
  executor: DbExecutor,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return executor instanceof PgTransaction
    ? fn(executor)
    : executor.transaction(fn);
}
