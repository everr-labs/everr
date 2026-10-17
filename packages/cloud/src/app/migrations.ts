import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { MigrationConfig } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { upgradeLegacyCloudDatabase } from "../db/legacy-migrations";
import {
  migrationConfig,
  type MigrationDatabase,
  migrateDatabase as migrateAppDatabase,
} from "@everr/app/db/migrations";

// Source paths are used by Vite development; the image ships only SQL/journals.
function migrationFolder(name: "cloud" | "legacy") {
  const packaged = `./drizzle/${name}`;
  return existsSync(`${packaged}/meta/_journal.json`)
    ? packaged
    : name === "cloud"
      ? resolve(import.meta.dirname, "../drizzle")
      : resolve(import.meta.dirname, "../drizzle-legacy");
}

export async function migrateDatabase(database: MigrationDatabase) {
  const cloudFolder = migrationFolder("cloud");
  await upgradeLegacyCloudDatabase(database, {
    legacyMigrationsFolder: migrationFolder("legacy"),
    appMigrationsFolder: migrationConfig.migrationsFolder,
    cloudMigrationsFolder: cloudFolder,
  });
  await migrateAppDatabase(database);
  await migrate(database, {
    migrationsFolder: cloudFolder,
    migrationsSchema: "drizzle",
    migrationsTable: "__everr_cloud_migrations",
  } satisfies MigrationConfig);
}
