import type { ApplicationEvents } from "./events";
import type { MigrationDatabase } from "#app/db/migrations.ts";

/**
 * A supervised background worker. Initial registration must not acquire running
 * resources or start it.
 * start() is idempotent and resolves once supervision is installed; individual
 * connection failures retry inside the supervisor. stop() drains startup and
 * running work, including a concurrent stop, and rejects on cleanup failure.
 * Stopping before start is safe. Signal handling belongs to the application runtime.
 */
export interface ApplicationWorker {
  start(this: void): Promise<void>;
  stop(this: void): Promise<void>;
}

/** Application-owned database upgrades and background work. */
export interface ApplicationRuntime {
  readonly events: ApplicationEvents;
  migrateDatabase(this: void, database: MigrationDatabase): Promise<void>;
  /** Only additional workers owned by this composition, never product workers. */
  registerWorkers(this: void): Promise<readonly ApplicationWorker[]>;
}
