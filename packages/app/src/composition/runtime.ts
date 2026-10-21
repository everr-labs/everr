import type { MigrationDatabase } from "#app/db/migrations.ts";

/** Application-owned database upgrades and background work. */
export interface ApplicationRuntime {
  migrateDatabase(this: void, database: MigrationDatabase): Promise<void>;
  startAppWorkers(this: void): Promise<{ stop(): Promise<void> }>;
}
