import { drizzle } from "drizzle-orm/node-postgres";
import { PgTransaction } from "drizzle-orm/pg-core";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema/index";

/** Construct database access without reading environment or opening connections on import. */
export function createDatabase(config: PoolConfig) {
  const pool = new Pool(config);
  return { pool, db: drizzle(pool, { schema }) };
}

/** Lock holders need a separate pool so they cannot starve the writes they await. */
export function createLockPool(config: PoolConfig) {
  return new Pool({
    ...config,
    // pg makes password non-enumerable on pool.options.
    password: config.password,
    max: 2,
  });
}

export type Database = ReturnType<typeof createDatabase>["db"];
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
