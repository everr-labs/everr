import type { ApplicationRuntime } from "@everr/app/composition";
import { db } from "@everr/app/db/client";
import {
  createOrganizationMilestoneStore,
  createTraceConsultations,
} from "../../organizations/milestones";

export const runtime: ApplicationRuntime = {
  events: [],
  createTraceConsultations(events) {
    return createTraceConsultations({ store: createOrganizationMilestoneStore(db), events });
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
