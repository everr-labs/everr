import type { ApplicationRuntime } from "@everr/app/composition";
import { serverLogger } from "@everr/app/telemetry/logger";
import { crmEventRoutes } from "../../crm/jobs";
import { appEnv } from "../env";

const crmEnabled = Boolean(appEnv.CRM_BREVO_API_KEY);

export const runtime: ApplicationRuntime = {
  events: crmEnabled ? crmEventRoutes() : [],
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("../migrations");
    return migrateDatabase(database);
  },
  async migrateClickHouse() {
    const { migrateCloudClickHouse } = await import("../clickhouse-migrations");
    return migrateCloudClickHouse();
  },
  async registerWorkers() {
    serverLogger.info("crm.integration.status", { "everr.crm.enabled": crmEnabled });
    const { organizationWorker } = await import("../../organization-provisioning/worker");
    if (!crmEnabled) return [organizationWorker];
    const { integrationWorker } = await import("../../crm/worker");
    return [organizationWorker, integrationWorker];
  },
};
