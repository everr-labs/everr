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
import { createRelatedSyncTasks, membershipFanout } from "./related-sync";
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
    reconcileMemberships: (saved, helpers, raw) =>
      fanout(
        saved.desired,
        helpers,
        saved.kind === "user" ? userSyncPayload.parse(raw) : organizationSyncPayload.parse(raw),
      ),
  });
  const related = createRelatedSyncTasks({ ...options, cleanup });
  const user = createUserSyncTask({
    ...options,
    reconcileMemberships: fanout,
    cleanup,
  });
  return {
    [USER_SYNC_TASK]: coordinateCrmTask(
      options.pool,
      options.deployment,
      (raw) => {
        const parsed = userSyncPayload.safeParse(raw);
        return parsed.success ? [JSON.stringify(["user", parsed.data.userId])] : [];
      },
      user,
      (raw) => userSyncSpec(userSyncPayload.parse(raw).userId),
    ),
    [ORGANIZATION_SYNC_TASK]: coordinateCrmTask(
      options.pool,
      options.deployment,
      (raw) => {
        const parsed = organizationSyncPayload.safeParse(raw);
        return parsed.success ? [JSON.stringify(["organization", parsed.data.organizationId])] : [];
      },
      related.organization,
      (raw) => relatedSyncSpec(organizationSyncPayload.parse(raw).organizationId),
    ),
    [MEMBERSHIP_SYNC_TASK]: coordinateCrmTask(
      options.pool,
      options.deployment,
      (raw) => {
        const parsed = membershipSyncPayload.safeParse(raw);
        return parsed.success
          ? [
              JSON.stringify(["organization", parsed.data.organizationId]),
              JSON.stringify(["user", parsed.data.userId]),
            ]
          : [];
      },
      related.membership,
      (raw) => {
        const payload = membershipSyncPayload.parse(raw);
        return relatedSyncSpec(payload.organizationId, payload.userId);
      },
    ),
  };
}
