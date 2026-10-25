import { createHash } from "node:crypto";
import type { TaskSpec } from "graphile-worker";
import { z } from "zod";

export const USER_SYNC_TASK = "crm/sync-user";
export const USER_SYNC_RETRIES = 8;
export const userSyncPayload = z
  .object({
    version: z.literal(1),
    userId: z.string().min(1).max(512),
    eventId: z.string().min(1).max(512),
    eventType: z.string().min(1).max(128),
    occurredAt: z.iso.datetime({ offset: true }),
    recoverExhaustedRevision: z.number().int().positive().optional(),
    verifyRemoteRevision: z.number().int().positive().optional(),
    recheckDeletionRevision: z.number().int().positive().optional(),
  })
  .strict();
export type UserSyncPayload = z.infer<typeof userSyncPayload>;

/** Fixed queue cardinality. Graphile holds the queue lock for the WHOLE task across replicas. */
export function userSyncSpec(userId: string): TaskSpec {
  const partition = createHash("sha256").update(userId).digest().readUInt32BE(0) % 64;
  return {
    queueName: `crm-user-${partition}`,
    maxAttempts: 8,
    jobKey: `crm-user-projection:${userId}`,
    jobKeyMode: "preserve_run_at",
  };
}

export const ORGANIZATION_SYNC_TASK = "crm/sync-organization";
export const MEMBERSHIP_SYNC_TASK = "crm/sync-membership";
const relatedPayload = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(512),
  eventType: z.string().min(1).max(128),
  occurredAt: z.iso.datetime({ offset: true }),
  recoverExhaustedRevision: z.number().int().positive().optional(),
  verifyRemoteRevision: z.number().int().positive().optional(),
  recheckDeletionRevision: z.number().int().positive().optional(),
  organizationId: z.string().min(1).max(512),
});
export const organizationSyncPayload = relatedPayload
  .extend({ kind: z.literal("organization") })
  .strict();
export const membershipSyncPayload = relatedPayload
  .extend({
    kind: z.literal("membership"),
    userId: z.string().min(1).max(512),
  })
  .strict();
export type OrganizationSyncPayload = z.infer<typeof organizationSyncPayload>;
export type MembershipSyncPayload = z.infer<typeof membershipSyncPayload>;

/** Fixed queues only. Endpoint advisory locks additionally coordinate parent interactions. */
export function relatedSyncSpec(id: string, userId?: string): TaskSpec {
  const partition = createHash("sha256").update(id).digest().readUInt32BE(0) % 64;
  return {
    queueName: `crm-related-${partition}`,
    maxAttempts: 8,
    jobKey:
      userId === undefined
        ? `crm-organization-projection:${id}`
        : `crm-pair:${JSON.stringify([userId, id])}`,
    jobKeyMode: "preserve_run_at",
  };
}
