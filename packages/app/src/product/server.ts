import type { MigrationDatabase } from "#app/db/migrations.ts";
import type { ApplicationPath } from "./client";

/**
 * The server-side deployment adapter for the shared application. Installation
 * entry and operational lifecycle belong to the selected
 * application; shared features depend on this contract rather than its implementation.
 */
export interface ApplicationServer {
  /** Account-deletion eligibility across owned organizations, complementary to mutation-time guards. */
  assertAccountDeletionAllowed(
    organizations: Array<{ id: string; name: string } | null>,
  ): void | Promise<void>;
  /** Public collector address advertised to clients; undefined represents an unconfigured endpoint. */
  getIngestEndpoint(): string | undefined;
  /** Application entry policy for static local routes, preserving href or to navigation semantics. */
  getEntryRedirect(
    pathname: string,
  ): Promise<{ href: ApplicationPath } | { to: ApplicationPath } | undefined>;
  /** Signup-page eligibility for a destination, distinct from admission of a specific identity. */
  canOpenSignup(input: { redirect?: string }): Promise<boolean>;
  /** Database upgrade lifecycle for the application's shared and additional schema histories. */
  migrateDatabase(database: MigrationDatabase): Promise<void>;
  /** Application-owned workers and the shutdown handle for their lifecycle. */
  startAppWorkers(): Promise<{ stop(): Promise<void> }>;
}
