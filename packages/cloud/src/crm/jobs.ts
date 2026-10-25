import type { ApplicationEvents } from "@everr/app/composition";
import { eventRegistration } from "@everr/app/server/events/registration";
import {
  membershipEventDefinitions,
  organizationEventDefinitions,
  userEventDefinitions,
} from "@everr/app/identity/events";
import { organizationReadinessEventDefinitions } from "@everr/app/organizations/events";
import { organizationMilestoneDefinitions } from "../organizations/events";
import { billingEventDefinitions } from "../billing/events";
import { addWorkerJob } from "@everr/app/server/worker/jobs";

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
): ApplicationEvents {
  if (mode === "disabled") return [];
  return userEventDefinitions.map((definition) =>
    eventRegistration(definition, {
      id: `crm.brevo.${definition.type}`,
      async enqueue(event) {
        if (event.subjectId !== event.data.userId) throw new Error("Invalid CRM user subject.");
        const payload = userSyncPayload.parse({
          version: 1,
          userId: event.data.userId,
          eventId: event.id,
          eventType: event.type,
          occurredAt: event.occurredAt,
        });
        await enqueue(USER_SYNC_TASK, payload, {
          ...userSyncSpec(payload.userId),
        });
      },
    }),
  );
}

export function organizationSyncSubscribers(
  mode: "disabled" | "configured" | "paused",
  enqueue: typeof addWorkerJob = addWorkerJob,
): ApplicationEvents {
  if (mode === "disabled") return [];
  const definitions = [
    ...organizationEventDefinitions,
    ...organizationReadinessEventDefinitions,
    ...billingEventDefinitions,
    ...organizationMilestoneDefinitions,
  ];
  return definitions.map((definition) =>
    eventRegistration(definition, {
      id: `crm.brevo.${definition.type}`,
      async enqueue(event) {
        if (event.subjectId !== event.data.organizationId)
          throw new Error("Invalid CRM organization subject.");
        const payload = organizationSyncPayload.parse({
          version: 1,
          kind: "organization",
          organizationId: event.data.organizationId,
          eventId: event.id,
          eventType: event.type,
          occurredAt: event.occurredAt,
        });
        await enqueue(ORGANIZATION_SYNC_TASK, payload, relatedSyncSpec(payload.organizationId));
      },
    }),
  );
}

export function membershipSyncSubscribers(
  mode: "disabled" | "configured" | "paused",
  enqueue: typeof addWorkerJob = addWorkerJob,
): ApplicationEvents {
  if (mode === "disabled") return [];
  return membershipEventDefinitions.map((definition) =>
    eventRegistration(definition, {
      id: `crm.brevo.${definition.type}`,
      async enqueue(event) {
        if (event.subjectId !== event.data.membershipId)
          throw new Error("Invalid CRM organization subject.");
        // The pair, not membership row identity or domain, is authoritative.
        const payload = membershipSyncPayload.parse({
          version: 1,
          kind: "membership",
          organizationId: event.data.organizationId,
          userId: event.data.userId,
          eventId: event.id,
          eventType: event.type,
          occurredAt: event.occurredAt,
        });
        await enqueue(
          MEMBERSHIP_SYNC_TASK,
          payload,
          relatedSyncSpec(payload.organizationId, payload.userId),
        );
      },
    }),
  );
}
