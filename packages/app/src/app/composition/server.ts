import type { ApplicationServer } from "#app/product/server.ts";
import * as clickhouse from "../clickhouse";
import * as ingest from "../ingest";
import * as storageReadiness from "../storage-readiness";

export const server: ApplicationServer = {
  ...clickhouse,
  telemetryTenantId: (_organizationId) => undefined,
  ...ingest,
  assertStorageReady: storageReadiness.assertStorageReady,
  async assertAccountDeletionAllowed(_organizations) {},
  async getEntryRedirect(pathname) {
    const { getEntryRedirect } = await import("../entry");
    return getEntryRedirect(pathname);
  },
  async canOpenSignup(input) {
    const { canOpenSignup } = await import("../signup");
    return canOpenSignup(input);
  },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("#app/db/migrations.ts");
    return migrateDatabase(database);
  },
  async startAppWorkers() {
    return { async stop() {} };
  },
};
