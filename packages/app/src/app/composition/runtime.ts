import { userEventDefinitions } from "#app/identity/events.ts";
import type { ApplicationRuntime } from "#app/composition/runtime.ts";

export const runtime: ApplicationRuntime = {
  businessEvents: { definitions: userEventDefinitions, subscribers: [] },
  async migrateDatabase(database) {
    const { migrateDatabase } = await import("#app/db/migrations.ts");
    return migrateDatabase(database);
  },
  async registerWorkers() {
    return [];
  },
};
