import { createHash } from "node:crypto";
import type { ApplicationBusinessEvents } from "@everr/app/composition";
import {
  membershipEventDefinitions,
  organizationEventDefinitions,
  userEventDefinitions,
} from "@everr/app/identity/events";
import { organizationReadinessEventDefinitions } from "@everr/app/organizations/events";
import { organizationMilestoneDefinitions } from "@everr/app/organizations/consultations";
import { billingEventDefinitions } from "../billing/events";
import { addWorkerJob } from "@everr/app/server/worker/jobs";
import type { TaskSpec } from "graphile-worker";
import { z } from "zod";

export const USER_SYNC_TASK = "crm/sync-user";
export const USER_SYNC_RETRIES = 8;
export const userSyncPayload = z
  .object({
    version: z.literal(1),
    userId: z.string().min(1).max(512),
    eventId: z.string().min(1).max(512),
    eventType: z.enum([
      "identity.user.created",
      "identity.user.updated",
      "identity.email.verified",
      "identity.user.deleted",
      "crm.reconciliation.requested",
    ]),
    occurredAt: z.iso.datetime({ offset: true }),
    failures: z.number().int().min(0).max(USER_SYNC_RETRIES),
    desiredRevision: z.number().int().positive().optional(),
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

export function userSyncSubscribers(
  mode: "disabled" | "configured" | "paused",
  enqueue: typeof addWorkerJob = addWorkerJob,
): ApplicationBusinessEvents["subscribers"] {
  if (mode === "disabled") return [];
  return userEventDefinitions.map((definition) => ({
    id: `crm.brevo.${definition.type}`,
    definition,
    async enqueue(event) {
      const fact = definition.parse({
        type: event.type,
        version: event.version,
        subjectId: event.subjectId,
        ...(event.actorId ? { actorId: event.actorId } : {}),
        data: event.data,
      });
      if (fact.subjectId !== fact.data.userId) throw new Error("Invalid CRM user subject.");
      const payload = userSyncPayload.parse({
        version: 1,
        userId: fact.data.userId,
        eventId: event.id,
        eventType: event.type,
        occurredAt: event.occurredAt,
        failures: 0,
      });
      await enqueue(USER_SYNC_TASK, payload, {
        ...userSyncSpec(payload.userId),
      });
    },
  }));
}

export const ORGANIZATION_SYNC_TASK = "crm/sync-organization";
export const MEMBERSHIP_SYNC_TASK = "crm/sync-membership";
const relatedPayload = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(512),
  eventType: z.string().min(1).max(128),
  occurredAt: z.iso.datetime({ offset: true }),
  failures: z.number().int().min(0).max(USER_SYNC_RETRIES),
  desiredRevision: z.number().int().positive().optional(),
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

export function organizationSyncSubscribers(
  mode: "disabled" | "configured" | "paused",
  enqueue: typeof addWorkerJob = addWorkerJob,
): ApplicationBusinessEvents["subscribers"] {
  if (mode === "disabled") return [];
  const definitions = [
    ...organizationEventDefinitions,
    ...membershipEventDefinitions,
    ...organizationReadinessEventDefinitions,
    ...billingEventDefinitions,
    ...organizationMilestoneDefinitions,
  ];
  return definitions.map((definition) => ({
    id: `crm.brevo.${definition.type}`,
    definition,
    async enqueue(event) {
      const fact = definition.parse({
        type: event.type,
        version: event.version,
        subjectId: event.subjectId,
        ...(event.actorId ? { actorId: event.actorId } : {}),
        data: event.data,
      });
      const membership = "membershipId" in fact.data;
      if (
        fact.subjectId !==
        ("membershipId" in fact.data ? fact.data.membershipId : fact.data.organizationId)
      )
        throw new Error("Invalid CRM organization subject.");
      const common = {
        version: 1,
        organizationId: fact.data.organizationId,
        eventId: event.id,
        eventType: event.type,
        occurredAt: event.occurredAt,
        failures: 0,
      };
      // The pair, not membership row identity or domain, is authoritative.
      const payload =
        membership && "userId" in fact.data
          ? membershipSyncPayload.parse({ ...common, kind: "membership", userId: fact.data.userId })
          : organizationSyncPayload.parse({ ...common, kind: "organization" });
      await enqueue(
        payload.kind === "membership" ? MEMBERSHIP_SYNC_TASK : ORGANIZATION_SYNC_TASK,
        payload,
        {
          ...relatedSyncSpec(
            payload.organizationId,
            payload.kind === "membership" ? payload.userId : undefined,
          ),
        },
      );
    },
  }));
}
