import { identityEventDefinitions } from "@everr/app/identity/events";
import type { ApplicationRuntime } from "@everr/app/composition";

export const runtime: ApplicationRuntime = {
  businessEvents: { definitions: identityEventDefinitions, subscribers: [] },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("../migrations");
    return migrateDatabase(database);
  },
  async registerWorkers() {
    const { organizationWorker } = await import("../../organization-provisioning/worker");
    return [organizationWorker];
  },
};
