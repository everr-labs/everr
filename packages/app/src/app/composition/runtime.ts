import { identityEventDefinitions } from "#app/identity/events.ts";
import { organizationReadinessEventDefinitions } from "#app/organizations/events.ts";
import type { ApplicationRuntime } from "#app/composition/runtime.ts";

export const runtime: ApplicationRuntime = {
  businessEvents: {
    definitions: [...identityEventDefinitions, ...organizationReadinessEventDefinitions],
    subscribers: [],
  },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("#app/db/migrations.ts");
    return migrateDatabase(database);
  },
  async registerWorkers() {
    return [];
  },
};
