import { identityEventDefinitions } from "@everr/app/identity/events";
import { organizationReadinessEventDefinitions } from "@everr/app/organizations/events";
import { billingEventDefinitions } from "../../billing/events";
import type { ApplicationRuntime } from "@everr/app/composition";
import { readBrevoConfig } from "../../crm/brevo/config";
import { userSyncSubscribers, organizationSyncSubscribers } from "../../crm/jobs";

const crmConfig = readBrevoConfig(process.env);

export const runtime: ApplicationRuntime = {
  businessEvents: {
    definitions: [
      ...identityEventDefinitions,
      ...organizationReadinessEventDefinitions,
      ...billingEventDefinitions,
    ],
    subscribers: [
      ...userSyncSubscribers(crmConfig.mode),
      ...organizationSyncSubscribers(crmConfig.mode),
    ],
  },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("../migrations");
    return migrateDatabase(database);
  },
  async registerWorkers() {
    const { organizationWorker } = await import("../../organization-provisioning/worker");
    if (crmConfig.mode !== "configured") return [organizationWorker];
    const { integrationWorker } = await import("../../crm/worker");
    return [organizationWorker, integrationWorker];
  },
};
