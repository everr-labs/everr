import type { MigrationConfig } from "drizzle-orm/migrator";

declare module "vitest" {
  interface ProvidedContext {
    alertingMigrations?: MigrationConfig[];
  }
}
