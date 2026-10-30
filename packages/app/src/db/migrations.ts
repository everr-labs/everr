import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { MigrationConfig } from "drizzle-orm/migrator";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool } from "./client";
import * as schema from "./schema";

export type MigrationDatabase = NodePgDatabase<typeof schema>;

export const migrationConfig: MigrationConfig = {
  migrationsFolder: existsSync("./drizzle/meta/_journal.json")
    ? "./drizzle"
    : resolve(import.meta.dirname, "../../drizzle"),
};

export async function migrateDatabase(database: MigrationDatabase) {
  await migrate(database, migrationConfig);
}

// Keep one connection locked throughout migration startup. Each Drizzle batch
// commits independently; a retry resumes from the last completed batch.
export async function withMigrationLock(run: (database: MigrationDatabase) => Promise<void>) {
  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    await client.query("select pg_advisory_lock(hashtext('everr.database.migrations'))");
    locked = true;
    await run(drizzle(client, { schema }));
  } finally {
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock(hashtext('everr.database.migrations'))");
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error(String(error));
      }
    }
    client.release(releaseError);
  }
}
