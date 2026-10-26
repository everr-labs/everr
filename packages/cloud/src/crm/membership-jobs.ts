import type { JobHelpers } from "graphile-worker";
import {
  MEMBERSHIP_SYNC_TASK,
  relatedSyncSpec,
  type UserSyncPayload,
  type OrganizationSyncPayload,
  type MembershipSyncPayload,
} from "./commands";
import type { DesiredProjection } from "./snapshots";
import type { createCrmProjectionStore } from "./store";

/** Reconcile explicit pairs, including retained mappings no longer present in source.
 * Enqueue prerequisites and continuations; never wait for another task in this runner.
 */
export async function enqueueMembershipSyncs(
  store: ReturnType<typeof createCrmProjectionStore>,
  snapshot: DesiredProjection,
  helpers: JobHelpers,
  origin: UserSyncPayload | OrganizationSyncPayload | MembershipSyncPayload,
) {
  if (snapshot.kind === "membership") return;
  const prior = await store.memberships(
    snapshot.kind === "user"
      ? { userId: snapshot.sourceId }
      : { organizationId: snapshot.sourceId },
  );
  const pairs = new Map<string, { userId: string; organizationId: string }>();
  for (const pair of [...prior, ...(snapshot.deleted ? [] : snapshot.memberships)]) {
    if (!pair.userId || !pair.organizationId) continue;
    pairs.set(JSON.stringify([pair.userId, pair.organizationId]), {
      userId: pair.userId,
      organizationId: pair.organizationId,
    });
  }
  for (const pair of pairs.values()) {
    const previous = prior.find(
      (row) => row.userId === pair.userId && row.organizationId === pair.organizationId,
    );
    const recheck =
      origin.eventType === "crm.reconciliation.requested" &&
      previous &&
      previous.syncedRevision === previous.desiredRevision &&
      previous.remoteCheckId !== origin.eventId
        ? previous.desiredRevision
        : undefined;
    await helpers.addJob(
      MEMBERSHIP_SYNC_TASK,
      {
        version: 1,
        kind: "membership",
        ...pair,
        eventId: origin.eventId,
        eventType: origin.eventType,
        occurredAt: origin.occurredAt,
        ...(recheck
          ? previous?.desired.deleted
            ? { recheckDeletionRevision: recheck }
            : { verifyRemoteRevision: recheck }
          : {}),
      },
      {
        ...relatedSyncSpec(pair.organizationId, pair.userId),
      },
    );
  }
}
