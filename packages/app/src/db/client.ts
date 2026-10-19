import type { PoolConfig } from "pg";
import { dbEnv } from "#app/env/db.ts";
import { createDatabase } from "./database";

export type { Database, DbExecutor, Transaction } from "./database";
export { runInTransaction } from "./database";

const shouldUseSsl = ["true", "1", "yes", "on"].includes(
  dbEnv.DATABASE_SSL?.toLowerCase() ?? "",
);

export const databasePoolConfig: PoolConfig = {
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
};

export const { pool, db } = createDatabase(databasePoolConfig);
