import type { ApplicationRuntime } from "@everr/app/composition";

export const runtime: ApplicationRuntime = {
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("../migrations");
    return migrateDatabase(database);
  },
  async startAppWorkers() {
    const { startOrganizationWorker } = await import("../../organization-provisioning/worker");
    return startOrganizationWorker();
  },
};
