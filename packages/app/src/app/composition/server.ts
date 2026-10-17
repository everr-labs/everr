import type { ApplicationServer } from "@/product/server";
import * as clickhouse from "../clickhouse";
import * as ingest from "../ingest";
import * as storageReadiness from "../storage-readiness";

export const server: ApplicationServer = {
  ...clickhouse,
  decorateTelemetryRow: (_organizationId, row) => row,
  ingestIdentity: (_organizationId) => ({}),
  internalIngestHeaders: (_organizationId) => ({}),
  ...ingest,
  assertStorageReady: storageReadiness.assertStorageReady,
  async loadIdentity() {
    const {
      identityAdapter,
      organizationHooks,
      identityLifecycle,
      authPlugins,
      membershipPlugins,
    } = await import("../auth");
    const { beforeUserCreate, createSessionOnboardingHook } = await import(
      "../onboarding"
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
    const { withIdentityRequest } = await import("../request");
    return withIdentityRequest(run);
  },
  async assertAccountDeletionAllowed(_organizations) {},
  async getAppEntry() {
    const { getAppEntry } = await import("../entry");
    return getAppEntry();
  },
  async canOpenSignup(input) {
    const { canOpenSignup } = await import("../signup");
    return canOpenSignup(input);
  },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("@/db/migrations");
    return migrateDatabase(database);
  },
  async startAppWorkers() {},
  async stopAppWorkers() {},
};
