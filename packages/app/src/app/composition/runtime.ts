import { identityEventDefinitions } from "#app/identity/events.ts";
import { organizationReadinessEventDefinitions } from "#app/organizations/events.ts";
import { businessEventRegistration } from "#app/server/business-events/subscriber.ts";
import type { ApplicationRuntime } from "#app/composition/runtime.ts";

export const runtime: ApplicationRuntime = {
  businessEvents: [...identityEventDefinitions, ...organizationReadinessEventDefinitions].map(
    (definition) => businessEventRegistration(definition),
  ),
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("#app/db/migrations.ts");
    return migrateDatabase(database);
  },
  async registerWorkers() {
    return [];
  },
};
