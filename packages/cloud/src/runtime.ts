import type { ApplicationServer } from "@everr/app/composition";
import * as clickhouse from "./app/clickhouse";
import * as storageReadiness from "./app/storage-readiness";

export const server: ApplicationServer = {
  ...clickhouse,
  telemetryTenantId: (organizationId) => organizationId,
  getIngestEndpoint: () => "https://ingest.everr.dev/",
  assertStorageReady: storageReadiness.assertStorageReady,
  async loadIdentity() {
    const { identity } = await import("./app/auth");
    return identity;
  },
  async assertAccountDeletionAllowed(organizations) {
    const { assertAccountDeletionAllowed } = await import("./app/account");
    return assertAccountDeletionAllowed(organizations);
  },
  async getAppEntry() {
    return { setupRequired: false };
  },
  async canOpenSignup() {
    return true;
  },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("./app/migrations");
    return migrateDatabase(database);
  },
  async startAppWorkers() {
    const { startOrganizationWorker } = await import(
      "./organization-provisioning/worker"
    );
    await startOrganizationWorker();
  },
  async stopAppWorkers() {
    const { stopOrganizationWorker } = await import(
      "./organization-provisioning/worker"
    );
    await stopOrganizationWorker();
  },
};
