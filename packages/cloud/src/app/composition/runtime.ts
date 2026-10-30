import type { ApplicationRuntime } from "@everr/app/composition";
import { readBrevoConfig } from "../../crm/brevo/config";
import { crmEventRoutes } from "../../crm/jobs";
import { appEnv } from "../env";

const crmConfig = readBrevoConfig(appEnv);

export const runtime: ApplicationRuntime = {
  events: crmEventRoutes(crmConfig.mode),
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
