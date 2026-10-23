import { createHash } from "node:crypto";
import type { ApplicationBusinessEvents } from "@everr/app/composition";
import { userEventDefinitions } from "@everr/app/identity/events";
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
    ]),
    occurredAt: z.iso.datetime({ offset: true }),
    failures: z.number().int().min(0).max(USER_SYNC_RETRIES),
    desiredRevision: z.number().int().positive().optional(),
  })
  .strict();
export type UserSyncPayload = z.infer<typeof userSyncPayload>;

/** Fixed queue cardinality. Graphile holds the queue lock for the WHOLE task across replicas. */
export function userSyncSpec(userId: string): TaskSpec {
  const partition = createHash("sha256").update(userId).digest().readUInt32BE(0) % 64;
  return { queueName: `crm-user-${partition}`, maxAttempts: 8 };
}

export function userSyncSubscribers(
  mode: "disabled" | "configured" | "paused",
  enqueue: typeof addWorkerJob = addWorkerJob,
): ApplicationBusinessEvents["subscribers"] {
  if (mode === "disabled") return [];
  return userEventDefinitions
    .filter((definition) => definition.type !== "identity.user.deleted")
    .map((definition) => ({
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
          jobKey: `crm-user:${event.id}`,
          jobKeyMode: "preserve_run_at",
        });
      },
    }));
}
