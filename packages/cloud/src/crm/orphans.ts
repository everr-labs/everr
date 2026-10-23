import type { JobHelpers } from "graphile-worker";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  relatedSyncSpec,
  userSyncSpec,
} from "./jobs";
import type { createCrmSnapshotReader, ProjectionKind } from "./snapshots";
import type { createCrmProjectionStore } from "./store";

/** Task 13 can persist the returned cursor and repeat pages. Reads current source IDs,
 * admits only missing-source work and leaves all mutation/HTTP to coordinated tasks.
 * No snapshot is saved here: a source change while checking cannot overwrite a worker.
 */
export async function enqueueCrmOrphans(options: {
  store: ReturnType<typeof createCrmProjectionStore>;
  reader: ReturnType<typeof createCrmSnapshotReader>;
  enqueue: (...args: Parameters<JobHelpers["addJob"]>) => Promise<unknown>;
  after?: { kind: ProjectionKind; sourceId: string };
  limit?: number;
  checkId: string;
  detectedAt: string;
}) {
  const page = await options.store.page(options.after, options.limit);
  let enqueued = 0;
  for (const row of page) {
    const userId = row.userId ?? "";
    const organizationId = row.organizationId ?? "";
    if ((row.kind !== "user" && !organizationId) || (row.kind === "membership" && !userId))
      throw new Error("Invalid CRM reconciliation endpoints.");
    const current =
      row.kind === "user"
        ? await options.reader.user(row.sourceId)
        : row.kind === "organization"
          ? await options.reader.organization(row.sourceId)
          : await options.reader.membership(userId, organizationId);
    if (!current.deleted && !row.deletedAt) continue;
    const origin = {
      version: 1,
      eventId: options.checkId,
      eventType: "crm.reconciliation.requested",
      occurredAt: options.detectedAt,
      ...(row.desired.deleted && row.syncedRevision === row.desiredRevision
        ? { recheckDeletionRevision: row.desiredRevision }
        : {}),
      failures: 0,
    };
    if (row.kind === "user") {
      await options.enqueue(
        USER_SYNC_TASK,
        { ...origin, userId: row.sourceId },
        userSyncSpec(row.sourceId),
      );
    } else {
      await options.enqueue(
        row.kind === "organization" ? ORGANIZATION_SYNC_TASK : MEMBERSHIP_SYNC_TASK,
        {
          ...origin,
          kind: row.kind,
          organizationId: organizationId,
          ...(row.kind === "membership" ? { userId: userId } : {}),
        },
        relatedSyncSpec(organizationId, row.kind === "membership" ? userId : undefined),
      );
    }
    enqueued++;
  }
  const last = page.at(-1);
  return {
    checked: page.length,
    enqueued,
    after: last ? { kind: last.kind, sourceId: last.sourceId } : undefined,
  };
}
