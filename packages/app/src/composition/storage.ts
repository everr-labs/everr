import type { ClickHouseSettings } from "@clickhouse/client";

/** Deployment-owned query access, storage readiness, and telemetry tenancy. */
export interface ApplicationStorage {
  /** Query isolation settings for the deployment's tenancy model. */
  appQuerySettings(
    organizationId: string,
    settings?: ClickHouseSettings,
  ): ClickHouseSettings | undefined;
  /** Organization-scoped SQL access, separate from the application's database identity. */
  sqlApiAccess(organizationId: string): {
    /** SQL API credentials for the selected organization. */
    auth: { username: string; password: string };
    /** Additional transport identity required by the deployment's SQL gateway. */
    http_headers?: Record<string, string>;
  };
  /** Organization storage-readiness policy, based on application-owned provisioning metadata. */
  assertStorageReady(metadata: unknown): void;
  /** Storage and collector tenant identity; production self-hosted omits the stamp. */
  telemetryTenantId(organizationId: string): string | undefined;
}
