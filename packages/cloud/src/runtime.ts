import type { ApplicationServer } from "@everr/app/product/server";
import * as clickhouse from "./app/clickhouse";
import * as storageReadiness from "./app/storage-readiness";

export const server: ApplicationServer = {
  ...clickhouse,
  decorateTelemetryRow: (organizationId, row) => ({
    ...row,
    tenant_id: organizationId,
  }),
  ingestIdentity: (organizationId) => ({ tenantId: organizationId }),
  internalIngestHeaders: (organizationId) => ({
    "x-everr-tenant-id": organizationId,
  }),
  getIngestEndpoint: () => "https://ingest.everr.dev/",
  assertStorageReady: storageReadiness.assertStorageReady,
  async loadIdentity() {
    const {
      identityAdapter,
      organizationHooks,
      identityLifecycle,
      authPlugins,
      membershipPlugins,
    } = await import("./app/auth");
    const { beforeUserCreate, createSessionOnboardingHook } = await import(
      "./app/onboarding"
    );
    return {
      identityAdapter,
      organizationHooks,
      identityLifecycle,
      authPlugins,
      membershipPlugin: membershipPlugins[0],
      beforeUserCreate,
      createSessionOnboardingHook,
    };
  },
  async withIdentityRequest(run) {
    const { withBillingRequest } = await import("./billing/lock.server");
    return withBillingRequest(run);
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
