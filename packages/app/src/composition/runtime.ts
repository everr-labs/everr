import type { MigrationDatabase } from "#app/db/migrations.ts";

/**
 * A supervised background worker. Registration must not start it.
 * start() is idempotent and resolves once supervision is installed; individual
 * connection failures retry inside the supervisor. stop() drains startup and
 * running work. Signal handling belongs to the application runtime.
 */
export interface ApplicationWorker {
  start(this: void): Promise<unknown>;
  stop(this: void): Promise<void>;
}

/** Application-owned database upgrades and background work. */
export interface ApplicationRuntime {
  migrateDatabase(this: void, database: MigrationDatabase): Promise<void>;
  /** Only additional workers owned by this composition, never product workers. */
  registerWorkers(this: void): Promise<readonly ApplicationWorker[]>;
}
