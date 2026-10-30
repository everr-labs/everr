import type { ApplicationRuntime } from "@everr/app/composition";
import { crmEventRoutes } from "../../crm/jobs";
import { appEnv } from "../env";

export const runtime: ApplicationRuntime = {
  events: crmEventRoutes(appEnv.CRM_BREVO_MODE ?? "disabled"),
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("../migrations");
    return migrateDatabase(database);
  },
  async registerWorkers() {
    const { organizationWorker } = await import("../../organization-provisioning/worker");
    if (appEnv.CRM_BREVO_MODE !== "configured") return [organizationWorker];
    const { integrationWorker } = await import("../../crm/worker");
    return [organizationWorker, integrationWorker];
  },
};
