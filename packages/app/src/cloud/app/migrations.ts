import { existsSync } from "node:fs";
import type { MigrationConfig } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { upgradeLegacyCloudDatabase } from "@/cloud/db/legacy-migrations";
import {
  coreMigrationConfig,
  type MigrationDatabase,
  migrateCoreDatabase,
} from "@/db/migrations";

// Source paths are used by Vite development; the image ships only SQL/journals.
function migrationFolder(name: "cloud" | "legacy") {
  const packaged = `./drizzle/${name}`;
  return existsSync(`${packaged}/meta/_journal.json`)
    ? packaged
    : name === "cloud"
      ? "./src/cloud/drizzle"
      : "./src/cloud/drizzle-legacy";
}

export async function migrateDatabase(database: MigrationDatabase) {
  const cloudFolder = migrationFolder("cloud");
  await upgradeLegacyCloudDatabase(database, {
    legacyMigrationsFolder: migrationFolder("legacy"),
    coreMigrationsFolder: coreMigrationConfig.migrationsFolder,
    cloudMigrationsFolder: cloudFolder,
  });
  await migrateCoreDatabase(database);
  await migrate(database, {
    migrationsFolder: cloudFolder,
    migrationsSchema: "drizzle",
    migrationsTable: "__everr_cloud_migrations",
  } satisfies MigrationConfig);
}
