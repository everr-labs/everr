import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type MigrationDatabase,
  migrateDatabase as migrateAppDatabase,
} from "@everr/app/db/migrations";
import type { MigrationConfig } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Source paths are used by Vite development; the image ships only SQL/journals.
function cloudMigrationFolder() {
  const packaged = "./drizzle/cloud";
  const built = resolve(import.meta.dirname, "../../drizzle/cloud");
  if (existsSync(`${packaged}/meta/_journal.json`)) return packaged;
  if (existsSync(`${built}/meta/_journal.json`)) return built;
  return resolve(import.meta.dirname, "../drizzle");
}

export async function migrateDatabase(database: MigrationDatabase) {
  await migrateAppDatabase(database);
  await migrate(database, {
    migrationsFolder: cloudMigrationFolder(),
    migrationsSchema: "drizzle",
    migrationsTable: "__everr_cloud_migrations",
  } satisfies MigrationConfig);
}
