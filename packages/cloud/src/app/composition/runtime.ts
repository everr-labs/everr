import { identityEventDefinitions } from "@everr/app/identity/events";
import { organizationReadinessEventDefinitions } from "@everr/app/organizations/events";
import { billingEventDefinitions } from "../../billing/events";
import type { ApplicationRuntime } from "@everr/app/composition";

export const runtime: ApplicationRuntime = {
  businessEvents: {
    definitions: [
      ...identityEventDefinitions,
      ...organizationReadinessEventDefinitions,
      ...billingEventDefinitions,
    ],
    subscribers: [],
  },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("../migrations");
    return migrateDatabase(database);
  },
  async registerWorkers() {
    const { organizationWorker } = await import("../../organization-provisioning/worker");
    return [organizationWorker];
  },
};
