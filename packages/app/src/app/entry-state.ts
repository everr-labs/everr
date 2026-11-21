import type { ApplicationEntry } from "#app/composition/entry.ts";
import { db } from "#app/db/client.ts";
import { getInstallation } from "./installation.server";

export const getEntryState: NonNullable<ApplicationEntry["getEntryState"]> = async () => ({
  setupRequired: !(await getInstallation(db)),
});
