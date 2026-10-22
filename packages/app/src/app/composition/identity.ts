import { db, pool } from "#app/db/client.ts";
import { createLockPool } from "#app/db/database.ts";
import { createInstallationIdentity } from "../identity";
import { createWorkspaceIdentityRequests } from "../request";

export const identity = createInstallationIdentity(
  db,
  createWorkspaceIdentityRequests(createLockPool(pool.options)),
);
