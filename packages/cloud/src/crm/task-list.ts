import type { TaskList } from "graphile-worker";
import type { Pool } from "pg";
import type { createBrevoAdapter } from "./brevo/adapter";
import { createDeletionCleanup } from "./deletion";
import { coordinateCrmTask } from "./coordination";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  membershipSyncPayload,
  organizationSyncPayload,
  userSyncPayload,
  relatedSyncSpec,
  userSyncSpec,
} from "./jobs";
import { createRelatedSyncTask, membershipFanout } from "./related-sync";
import type { createCrmSnapshotReader } from "./snapshots";
import type { createCrmProjectionStore } from "./store";
import type { SyncDiagnostic } from "./telemetry";
import { createUserSyncTask } from "./user-sync";

/** All production entry points share cross-replica endpoint locks, including parent jobs. */
export function createCrmTaskList(options: {
  pool: Pick<Pool, "connect">;
  deployment: string;
  reader: ReturnType<typeof createCrmSnapshotReader>;
  store: ReturnType<typeof createCrmProjectionStore>;
  adapter: ReturnType<typeof createBrevoAdapter>;
  diagnostic?: SyncDiagnostic;
}): TaskList {
  const fanout = membershipFanout(options.store);
  const cleanup = createDeletionCleanup({
    ...options,
    reconcileMemberships: (saved, helpers, payload) => fanout(saved.desired, helpers, payload),
  });
  const related = createRelatedSyncTask({ ...options, cleanup });
  const user = createUserSyncTask({
    ...options,
    reconcileMemberships: fanout,
    cleanup,
  });
  return {
    [USER_SYNC_TASK]: coordinateCrmTask({
      ...options,
      schema: userSyncPayload,
      endpoints: (payload) => [JSON.stringify(["user", payload.userId])],
      task: user,
      spec: (payload) => userSyncSpec(payload.userId),
      invalidMessage: "Invalid CRM user task payload.",
    }),
    [ORGANIZATION_SYNC_TASK]: coordinateCrmTask({
      ...options,
      schema: organizationSyncPayload,
      endpoints: (payload) => [JSON.stringify(["organization", payload.organizationId])],
      task: related,
      spec: (payload) => relatedSyncSpec(payload.organizationId),
      invalidMessage: "Invalid CRM related task payload.",
    }),
    [MEMBERSHIP_SYNC_TASK]: coordinateCrmTask({
      ...options,
      schema: membershipSyncPayload,
      endpoints: (payload) => [
        JSON.stringify(["organization", payload.organizationId]),
        JSON.stringify(["user", payload.userId]),
      ],
      task: related,
      spec: (payload) => relatedSyncSpec(payload.organizationId, payload.userId),
      invalidMessage: "Invalid CRM related task payload.",
    }),
  };
}
