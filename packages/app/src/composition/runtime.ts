import type { MigrationDatabase } from "#app/db/migrations.ts";

/** Application-owned database upgrades and background work. */
export interface ApplicationRuntime {
  migrateDatabase(database: MigrationDatabase): Promise<void>;
  startAppWorkers(): Promise<{ stop(): Promise<void> }>;
}
