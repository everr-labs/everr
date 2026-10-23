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

export * from "./commands";
import {
  USER_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  MEMBERSHIP_SYNC_TASK,
  userSyncPayload,
  organizationSyncPayload,
  membershipSyncPayload,
  userSyncSpec,
  relatedSyncSpec,
} from "./commands";

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
