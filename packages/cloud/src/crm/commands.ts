import type { TaskSpec } from "graphile-worker";
import { z } from "zod";

export const USER_SYNC_TASK = "crm/sync-user";
export const CRM_QUEUE = "crm-brevo";
export const userSyncPayload = z
  .object({
    version: z.literal(1),
    userId: z.string().min(1).max(512),
    eventId: z.string().min(1).max(512),
    eventType: z.string().min(1).max(128),
    occurredAt: z.iso.datetime({ offset: true }),
    prune: z.boolean().optional(),
  })
  .strict();
export type UserSyncPayload = z.infer<typeof userSyncPayload>;

/** One outbound queue serializes provider work across all replicas. */
export function userSyncSpec(userId: string): TaskSpec {
  return {
    queueName: CRM_QUEUE,
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
  prune: z.boolean().optional(),
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

/** Stable entity keys coalesce notifications; handlers always read current state. */
export function relatedSyncSpec(id: string, userId?: string): TaskSpec {
  return {
    queueName: CRM_QUEUE,
    maxAttempts: 8,
    jobKey:
      userId === undefined
        ? `crm-organization-projection:${id}`
        : `crm-pair:${JSON.stringify([userId, id])}`,
    jobKeyMode: "preserve_run_at",
  };
}

export const FULL_SYNC_TASK = "crm/full-sync";
export const fullSyncPayload = z
  .object({
    version: z.literal(1),
    eventId: z.string().min(1).max(512),
    eventType: z.literal("crm.full-sync.requested"),
    occurredAt: z.iso.datetime({ offset: true }),
    prune: z.boolean(),
    apply: z.boolean(),
  })
  .strict()
  .refine((value) => !value.apply || value.prune);
export type FullSyncPayload = z.infer<typeof fullSyncPayload>;
export function fullSyncSpec(): TaskSpec {
  return {
    queueName: CRM_QUEUE,
    maxAttempts: 8,
    jobKey: "crm-full-sync",
    jobKeyMode: "preserve_run_at",
  };
}
