import { resolve } from "node:path";
import type { MigrationConfig } from "drizzle-orm/migrator";

export const cloudTestMigrations: MigrationConfig[] = [
  {
    migrationsFolder: resolve(import.meta.dirname, "../drizzle"),
    migrationsSchema: "drizzle",
    migrationsTable: "__everr_cloud_migrations",
  },
];
