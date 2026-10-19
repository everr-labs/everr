import type { ApplicationServer } from "#app/product/server.ts";
import { appEnv } from "../env";

export const server: ApplicationServer = {
  getIngestEndpoint() {
    return appEnv.EVERR_PUBLIC_INGEST_URL;
  },
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
